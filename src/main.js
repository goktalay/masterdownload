'use strict';

// Master Download: çok bağlantılı, sürdürülebilir indirme yöneticisi (Mastertool ailesi).
// İndirme motoru src/engine/ (Electron'dan bağımsız); burada pencereler, tepsi, ayarlar, hesap, tarayıcı kanalı,
// pano izleme, zamanlayıcı eylemleri ve güncelleme bulunur. Mimari: docs/mimari.md.

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, nativeTheme, dialog, clipboard, safeStorage, Notification, session, powerSaveBlocker, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const I18N = require('./i18n');
const { createSso } = require('./sso');
const { createAccount, compareVersions, apiBase, APP } = require('./account');
const { DownloadManager } = require('./engine/manager');
const { defaultCategories, parseExts } = require('./engine/categories');
const { defaultQueues, nextStart, MAIN } = require('./engine/queue');
const { expandPattern, extractLinks, isDownloadLink } = require('./engine/batch');
const { parseEf2, formatEf2, formatList } = require('./engine/ef2');
const { grab } = require('./engine/grabber');
const { fetchText } = require('./engine/http');
const { parseArgs, hasWork } = require('./cli');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');

// ---------------------------------------------------------------------------
// Ayarlar (userData/store.json)
// ---------------------------------------------------------------------------
const DEFAULT_EXTS = ['zip', 'rar', '7z', 'gz', 'tar', 'iso', 'exe', 'msi', 'apk', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v', 'bin', 'img', 'dmg', 'deb', 'rpm', 'jar'];

const defaultSettings = () => ({
  appTheme: 'system', language: null, openAtLogin: false, minimizeToTray: true, closeToTray: true, checkUpdates: true, trayHintShown: false,
  connection: { maxConnections: 8, retries: 20, timeoutSec: 30, userAgent: '', proxy: { mode: 'system', host: '', port: '', user: '', pass: '' } },
  downloads: {
    dir: path.join(app.getPath('downloads'), 'Master Download'), tempDir: '', duplicate: 'rename',
    showStartDialog: true, showProgress: true, showComplete: true, notify: true, sound: false,
    virusScan: false, scanner: 'defender', scannerPath: '', scannerArgs: '"[File]"', motw: true, resumeOnStart: false,
  },
  speedLimit: { enabled: false, kbps: 1024 },
  browser: { enabled: true, exts: DEFAULT_EXTS, minSizeKB: 0, skipSites: [], videoButton: true },
  clipboard: { watch: false },
  dropTarget: { show: false, x: null, y: null },
  categories: defaultCategories(),
  queues: defaultQueues(),
  columns: ['name', 'size', 'status', 'speed', 'eta', 'added'],
});

let store = null;
const storePath = () => path.join(app.getPath('userData'), 'store.json');

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = { settings: deepMerge(defaultSettings(), s.settings || {}) };
  } catch {
    store = { settings: defaultSettings() };
  }
  applyAppTheme();
  applyLanguage();
}

let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    const tmp = `${storePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, storePath());
  }, 200);
}

let t = I18N.createT('en');
const currentLang = () => (store && store.settings.language) || I18N.resolveLanguage(app.getLocale());
function applyLanguage() { t = I18N.createT(currentLang()); }

function applyAppTheme() {
  const v = store.settings.appTheme;
  nativeTheme.themeSource = v === 'dark' || v === 'light' ? v : 'system';
}
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#eef2f7');
const themeParam = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

const tempDir = () => store.settings.downloads.tempDir || path.join(app.getPath('userData'), 'temp');

// ---------------------------------------------------------------------------
// İndirme yöneticisi
// ---------------------------------------------------------------------------
let manager = null;
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
const encrypt = (s) => (canEncrypt() ? `e:${safeStorage.encryptString(s).toString('base64')}` : `p:${Buffer.from(s).toString('base64')}`);
const decrypt = (s) => (String(s).startsWith('e:') ? safeStorage.decryptString(Buffer.from(String(s).slice(2), 'base64')) : Buffer.from(String(s).slice(2), 'base64').toString());

function initManager() {
  manager = new DownloadManager({
    dataDir: app.getPath('userData'),
    tempDir: tempDir(),
    getSettings: () => store.settings,
    categoryLabel: (id) => t(`cat.${id}`),
    encrypt, decrypt,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
  });
  let pending = false;
  manager.on('changed', () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; send('dl:list', manager.list()); updateTray(); }, 100);
  });
  manager.on('progress', (p) => { sendThrottled(p); });
  manager.on('completed', onCompleted);
  manager.on('failed', (it) => {
    sendTo(progressWins.get(it.id), 'pw:state', manager.view(manager.get(it.id)));
    if (store.settings.downloads.notify && !isFocused()) notify(t('note.failed'), `${it.fileName || it.url}\n${t(`err.${it.error}`, {}) !== `err.${it.error}` ? t(`err.${it.error}`) : it.error}`);
  });
  manager.on('warning', ({ id, code }) => send('dl:warning', { id, code }));
  manager.on('queueDone', onQueueDone);
  manager.on('queues', () => send('dl:queues', queueState()));
  manager.on('settingsChanged', () => { saveStore(); });
  manager.runner.begin(15000);
  // Uygulama kapanırken süren indirmeler istenirse kaldığı yerden sürer
  if (store.settings.downloads.resumeOnStart) for (const it of manager.items) if (it.wasActive) manager.start(it.id);
}

// İlerleme olayları pencereye en çok 4/sn gider
const progressBuf = new Map();
let progressTimer = null;
function sendThrottled(p) {
  progressBuf.set(p.id, p);
  sendTo(progressWins.get(p.id), 'pw:progress', p);
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    send('dl:progress', [...progressBuf.values()]);
    progressBuf.clear();
    updateTrayTooltip();
  }, 250);
}

function queueState() {
  const now = new Date();
  return store.settings.queues.map((q) => ({ ...q, running: manager.runner.isRunning(q.id), next: nextStart(q, now) ? nextStart(q, now).getTime() : null }));
}

async function onCompleted(it) {
  const s = store.settings.downloads;
  const rec = manager.get(it.id);
  // İnternetten gelen dosya işareti (Mark of the Web): Windows SmartScreen/Office korumalı görünüm uygular
  if (process.platform === 'win32' && s.motw && rec && rec.dest) {
    const zone = `[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=${rec.referrer || ''}\r\nHostUrl=${rec.finalUrl || rec.url}\r\n`;
    fs.promises.writeFile(`${rec.dest}:Zone.Identifier`, zone).catch(() => {});
  }
  if (s.virusScan && rec && rec.dest) scanFile(rec).catch(() => {});
  const win = progressWins.get(it.id);
  if (win && s.showComplete) sendTo(win, 'pw:state', manager.view(rec));
  else if (win) win.close();
  if (s.notify && !isFocused()) {
    const n = notify(t('note.completed'), it.fileName);
    if (n) n.on('click', () => { if (rec && rec.dest) shell.openPath(rec.dest); });
  }
  if (s.sound) shell.beep();
}

// Bitince virüs taraması: Windows Defender (MpCmdRun) ya da kullanıcının tarayıcısı ("[File]" yer tutucusu)
function scanFile(rec) {
  const s = store.settings.downloads;
  let exe, args;
  if (s.scanner === 'custom' && s.scannerPath) {
    exe = s.scannerPath;
    args = splitArgs(s.scannerArgs || '"[File]"').map((a) => a.replace(/\[File\]/gi, rec.dest));
  } else {
    exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
    args = ['-Scan', '-ScanType', '3', '-File', rec.dest, '-DisableRemediation'];
  }
  send('dl:scan', { id: rec.id, state: 'scanning' });
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: 10 * 60 * 1000 }, (err) => {
      // MpCmdRun: 0 = temiz, 2 = tehdit bulundu
      const state = !err ? 'clean' : err.code === 2 ? 'threat' : 'failed';
      send('dl:scan', { id: rec.id, state });
      if (state === 'threat') notify(t('scan.threatTitle'), t('scan.threatBody', { name: rec.fileName }));
      resolve(state);
    });
  });
}

function splitArgs(s) {
  const out = [];
  String(s).replace(/"([^"]*)"|(\S+)/g, (_m, q, w) => { out.push(q !== undefined ? q : w); return ''; });
  return out;
}

// Kuyruk bitince eylem: 60 sn geri sayım (ana pencerede iptal edilebilir), sonra uygulanır
let afterTimer = null;
function onQueueDone(q) {
  send('dl:queues', queueState());
  if (!q.after || q.after === 'none') return;
  showMainWindow();
  send('dl:after', { queue: q.id, action: q.after, seconds: 60 });
  clearTimeout(afterTimer);
  afterTimer = setTimeout(() => runAfterAction(q.after), 60000);
}

function runAfterAction(action) {
  afterTimer = null;
  if (action === 'exit') return quitApp();
  if (process.platform !== 'win32') return;
  if (action === 'shutdown') execFile('shutdown.exe', ['/s', '/t', '0'], { windowsHide: true });
  if (action === 'sleep') execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true });
  if (action === 'hibernate') execFile('shutdown.exe', ['/h'], { windowsHide: true });
}

// İndirme sürerken bilgisayar uykuya geçmesin
let blockerId = null;
setInterval(() => {
  if (!manager) return;
  const busy = manager.activeCount() > 0;
  if (busy && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!busy && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
}, 5000).unref();

// ---------------------------------------------------------------------------
// İndirme ekleme (pencere, tarayıcı, komut satırı, pano, bırakma hedefi)
// ---------------------------------------------------------------------------
const pendingAdds = []; // giriş yapılmadan gelen istekler
let addSeq = 0;
const recentAdds = new Map(); // adres → zaman

// req: { url, referrer, cookies, ua, filename, size, mime, kind, pageUrl, title, dir, silent, start, queue }
function requestAdd(req) {
  if (!account || !account.isLoggedIn()) {
    pendingAdds.push(req);
    showLogin();
    return { ok: true, pending: true };
  }
  const url = String(req.url || '').trim();
  if (!/^(https?|ftp):\/\//i.test(url)) return { ok: false, code: 'invalid_url' };
  // Eklenti uygulamayı başlatırken zaman aşımına uğrayıp aynı adresi yeniden gönderebilir: 30 sn içinde yinelenen istek yok sayılır
  const now = Date.now();
  for (const [u, at] of recentAdds) if (now - at > 30000) recentAdds.delete(u);
  if (recentAdds.has(url)) return { ok: true, duplicate: true };
  recentAdds.set(url, now);
  const silent = req.silent || !store.settings.downloads.showStartDialog;
  if (silent) {
    const it = manager.add({ ...req, url, fileName: req.filename || req.fileName, start: req.start !== false && !req.queue });
    if (it.duplicate && req.start !== false) manager.start(it.id);
    if (store.settings.downloads.showProgress && req.start !== false && !req.queue) openProgress(it.id);
    return { ok: true, id: it.id };
  }
  // "Yeni indirme" penceresi ana pencerede açılır (kullanıcı ad, klasör, kategori, kuyruk seçer)
  showMainWindow();
  const id = `req-${++addSeq}`;
  sendWhenReady('dl:addDialog', { ...req, url, reqId: id });
  return { ok: true, pending: true };
}

function flushPendingAdds() {
  while (pendingAdds.length) {
    const r = pendingAdds.shift();
    if (r.batch) { showMainWindow(); sendWhenReady('dl:batchDialog', { items: r.batch.map((x) => ({ url: x.url, referrer: x.referrer || '', fileName: x.filename || '' })) }); } else requestAdd(r);
  }
}

function handleCli(argv) {
  const o = parseArgs(argv);
  if (!hasWork(o)) return false;
  if (o.url) {
    requestAdd({ url: o.url, dir: o.dir || '', filename: o.fileName || '', silent: o.silent, queue: o.addOnly ? MAIN : null, start: !o.addOnly });
    if (o.quit) quitWhenIdle = true;
  }
  for (const f of o.files) importFile(f).catch(() => {});
  if (o.startQueue) manager.startQueue(MAIN);
  return true;
}
let quitWhenIdle = false;
setInterval(() => { if (quitWhenIdle && manager && manager.activeCount() === 0 && !manager.items.some((x) => x.status === 'queued')) quitApp(); }, 3000).unref();

async function importFile(file) {
  const text = await fs.promises.readFile(file, 'utf8');
  const items = /\.ef2$/i.test(file) ? parseEf2(text) : extractLinks(text).map((url) => ({ url }));
  showMainWindow();
  sendWhenReady('dl:batchDialog', { items: items.map((x) => ({ url: x.url, referrer: x.referrer || '', ua: x.ua || '', fileName: x.fileName || '' })) });
  return items.length;
}

// Tarayıcı eklentisi (native host → adlandırılmış kanal)
let bridge = null;
function initBridge() {
  let mod;
  try { mod = require('./bridge'); } catch { return; }
  bridge = mod.createBridge({
    onMessage: async (msg) => {
      if (!msg || msg.v !== 1) return { ok: false, code: 'bad_request' };
      if (msg.type === 'ping') return { ok: true, version: app.getVersion(), enabled: !!store.settings.browser.enabled, settings: browserSettings() };
      if (!store.settings.browser.enabled) return { ok: false, code: 'disabled' };
      if (msg.type === 'add') return requestAdd({ url: msg.url, referrer: msg.referrer, cookies: msg.cookies, ua: msg.ua, filename: msg.filename, size: msg.size, mime: msg.mime, kind: ['hls', 'dash'].includes(msg.kind) ? msg.kind : undefined, pageUrl: msg.pageUrl, title: msg.title });
      if (msg.type === 'addMany') {
        if (!account.isLoggedIn()) { pendingAdds.push({ batch: msg.items }); showLogin(); return { ok: true, pending: true }; }
        showMainWindow();
        sendWhenReady('dl:batchDialog', { items: (msg.items || []).slice(0, 5000).map((x) => ({ url: x.url, referrer: x.referrer || msg.referrer || '', fileName: x.filename || '', cookies: msg.cookies || '' })) });
        return { ok: true, pending: true };
      }
      return { ok: false, code: 'unknown_type' };
    },
  });
  bridge.listen().catch(() => {});
}
const browserSettings = () => ({ exts: store.settings.browser.exts, minSizeKB: store.settings.browser.minSizeKB, skipSites: store.settings.browser.skipSites, videoButton: store.settings.browser.videoButton });

// Native host kaydı (Chrome, Edge, Firefox) — yalnız paketlenmiş uygulamada
function registerNativeHost() {
  if (process.platform !== 'win32' || !app.isPackaged) return { ok: false, code: 'dev' };
  let reg;
  try { reg = require('./nm-register'); } catch { return { ok: false, code: 'missing' }; }
  const dir = path.join(app.getPath('appData'), '..', 'Local', 'Master Download', 'nmhost');
  reg.writeHostFiles({ dir, exePath: process.execPath, appAsarPath: path.join(process.resourcesPath, 'app.asar'), chromiumIds: reg.CHROMIUM_IDS });
  for (const args of reg.registryCommands({ dir })) execFile('reg.exe', args, { windowsHide: true }, () => {});
  return { ok: true };
}

// Pano izleme: kopyalanan tek indirilebilir bağlantı için "indir" önerisi
let lastClip = '';
setInterval(() => {
  if (!store || !store.settings.clipboard.watch || !account || !account.isLoggedIn()) return;
  const text = clipboard.readText().trim();
  if (!text || text === lastClip) return;
  lastClip = text;
  if (isDownloadLink(text, store.settings.browser.exts)) requestAdd({ url: text });
}, 1000).unref();

// ---------------------------------------------------------------------------
// Pencereler
// ---------------------------------------------------------------------------
let mainWindow = null;
let loginWindow = null;
let dropWindow = null;
let isQuitting = false;
const progressWins = new Map();

const webPrefs = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false });
const isFocused = () => BrowserWindow.getFocusedWindow() !== null;

function send(channel, data) { sendTo(mainWindow, channel, data); }
function sendTo(win, channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function sendWhenReady(channel, data) {
  if (!mainWindow) return;
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', () => send(channel, data));
  else send(channel, data);
}

function notify(title, body) {
  if (!Notification.isSupported()) return null;
  const n = new Notification({ title, body, icon: ICON, silent: true });
  n.show();
  return n;
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440, height: 640, resizable: false, maximizable: false,
    backgroundColor: windowBg(), title: 'Master Download', icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  loginWindow.setMenuBarVisibility(false);
  loginWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  loginWindow.on('closed', () => (loginWindow = null));
}

function showLogin() {
  if (!loginWindow) createLoginWindow();
  else { loginWindow.show(); loginWindow.focus(); }
}

function createMainWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 860, minHeight: 540, show,
    backgroundColor: windowBg(), title: 'Master Download', icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('minimize', (e) => {
    if (!store.settings.minimizeToTray) return;
    e.preventDefault();
    hideToTray();
  });
  mainWindow.on('close', (e) => {
    if (store.settings.closeToTray && !isQuitting) { e.preventDefault(); hideToTray(); }
  });
  mainWindow.on('closed', () => (mainWindow = null));
}

function showMainWindow() {
  if (!account || !account.isLoggedIn()) { showLogin(); return; }
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  if (!store.settings.trayHintShown && tray) {
    store.settings.trayHintShown = true;
    saveStore();
    tray.displayBalloon({ iconType: 'info', title: t('tray.balloonTitle'), content: t('tray.balloonBody') });
  }
}

// IDM'deki indirme ilerleme penceresi: indirme başına küçük pencere (hız, kalan süre, bölüm haritası, bitince aç)
function openProgress(id) {
  if (progressWins.has(id)) { const w = progressWins.get(id); w.show(); w.focus(); return; }
  const w = new BrowserWindow({
    width: 560, height: 430, resizable: true, minWidth: 480, minHeight: 380, maximizable: false,
    backgroundColor: windowBg(), title: 'Master Download', icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'progress.html'), { query: { id } });
  w.on('closed', () => progressWins.delete(id));
  progressWins.set(id, w);
}

// Bırakma hedefi: her zaman üstte küçük yuvarlak pencere; bağlantı bırakılınca Yeni indirme
function toggleDropTarget(show) {
  store.settings.dropTarget.show = !!show;
  saveStore();
  if (!show) { if (dropWindow) dropWindow.close(); return; }
  if (dropWindow) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const { x, y } = store.settings.dropTarget;
  dropWindow = new BrowserWindow({
    width: 72, height: 72, x: x ?? wa.x + wa.width - 110, y: y ?? wa.y + wa.height - 130,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    title: 'Master Download', icon: ICON, webPreferences: webPrefs(),
  });
  dropWindow.loadFile(path.join(__dirname, 'renderer', 'drop.html'));
  dropWindow.on('moved', () => { const b = dropWindow.getBounds(); store.settings.dropTarget.x = b.x; store.settings.dropTarget.y = b.y; saveStore(); });
  dropWindow.on('closed', () => (dropWindow = null));
  updateTray();
}

async function quitApp() {
  isQuitting = true;
  if (manager) await manager.shutdown().catch(() => {});
  app.quit();
}

// ---------------------------------------------------------------------------
// Tepsi: her zaman görünür. Tek tık menü, çift tık pencere; araç ipucunda toplam hız
// ---------------------------------------------------------------------------
let tray = null;

function fmtSpeed(bps) {
  if (!bps) return '0 KB/s';
  return bps >= 1048576 ? `${(bps / 1048576).toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`;
}

function updateTrayTooltip() {
  if (!tray || !manager) return;
  const n = manager.activeCount();
  tray.setToolTip(n ? `Master Download — ${t('tray.active', { n })} · ${fmtSpeed(manager.totalSpeed())}` : 'Master Download');
}

function trayMenu() {
  const s = store.settings;
  const mainRunning = manager && manager.runner.isRunning(MAIN);
  return Menu.buildFromTemplate([
    { label: t('tray.show'), click: showMainWindow },
    { type: 'separator' },
    { label: t('tray.addUrl'), click: () => { showMainWindow(); sendWhenReady('dl:addDialog', {}); }, enabled: !!(account && account.isLoggedIn()) },
    { label: t('tray.fromClipboard'), click: () => { const links = extractLinks(clipboard.readText()); if (links.length === 1) requestAdd({ url: links[0] }); else if (links.length) { showMainWindow(); sendWhenReady('dl:batchDialog', { items: links.map((url) => ({ url })) }); } }, enabled: !!(account && account.isLoggedIn()) },
    { label: mainRunning ? t('tray.stopQueue') : t('tray.startQueue'), click: () => (mainRunning ? manager.stopQueue(MAIN) : manager.startQueue(MAIN)), enabled: !!manager },
    { label: t('tray.pauseAll'), click: () => manager && manager.pauseAll(), enabled: !!(manager && manager.activeCount()) },
    { type: 'separator' },
    { label: t('tray.speedLimit'), type: 'checkbox', checked: !!s.speedLimit.enabled, click: (mi) => { s.speedLimit.enabled = mi.checked; saveStore(); manager.applySpeedLimit(); send('settings:changed', s); } },
    { label: t('tray.clipboard'), type: 'checkbox', checked: !!s.clipboard.watch, click: (mi) => { s.clipboard.watch = mi.checked; lastClip = clipboard.readText().trim(); saveStore(); } },
    { label: t('tray.dropTarget'), type: 'checkbox', checked: !!s.dropTarget.show, click: (mi) => toggleDropTarget(mi.checked) },
    { type: 'separator' },
    { label: t('tray.quit'), click: quitApp },
  ]);
}

let trayTimer = null;
function updateTray() {
  if (!tray) return;
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => { tray.setContextMenu(trayMenu()); updateTrayTooltip(); }, 150);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('Master Download');
  tray.setContextMenu(trayMenu());
  tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', showMainWindow);
}

// ---------------------------------------------------------------------------
// Hesap ve ortak oturum
// ---------------------------------------------------------------------------
let account = null;
let loginNotice = '';

// Ortak kimlik deposu (Windows Kimlik Bilgisi Yöneticisi) açılamazsa uygulama yalnız kendi oturumuyla çalışır
function openSso() {
  try { return createSso({ stateDir: path.join(app.getPath('appData'), 'Mastertool') }); } catch { return null; }
}

function initAccount() {
  account = createAccount({
    userDataDir: app.getPath('userData'), appVersion: app.getVersion(), encrypt, decrypt,
    sso: openSso(),
    onStatus: (st) => send('account:state', st),
    onSessionExpired: (code) => {
      manager && manager.pauseAll();
      loginNotice = t(code === 'app_disabled' ? 'auth.errAppDisabled' : code === 'wrong_app' ? 'auth.errWrongApp' : 'auth.errSessionExpired');
      closeMainAndShowLogin();
    },
    onSharedLogin: () => { if (loginWindow) { loginWindow.close(); createMainWindow(); flushPendingAdds(); } },
    onSharedLogout: async () => {
      if (manager) await manager.pauseAll();
      account.endLocal();
      loginNotice = t('auth.signedOutElsewhere');
      closeMainAndShowLogin();
    },
  });
}

function closeMainAndShowLogin() {
  for (const w of progressWins.values()) w.close();
  if (mainWindow) { mainWindow.removeAllListeners('close'); mainWindow.close(); }
  showLogin();
}

// ---------------------------------------------------------------------------
// Güncelleme (GET /api/md/releases/latest, /api/md/apps/md/download?kind=setup)
// ---------------------------------------------------------------------------
let updateInfo = null;
async function checkUpdate({ manual = false } = {}) {
  if (!manual && !store.settings.checkUpdates) return null;
  try {
    const r = await account.latestRelease();
    const newer = !!(r && r.version && compareVersions(r.version, app.getVersion()) > 0);
    updateInfo = newer ? { version: r.version, notes: r.notes || '' } : null;
    if (newer) sendWhenReady('app:update', updateInfo);
    return { latest: (r && r.version) || null, current: app.getVersion(), newer };
  } catch (e) {
    if (manual) throw e;
    return null;
  }
}

// Güncelleme kendi motorumuzla iner (çok bağlantılı, sürdürülebilir), sonra kurulum çalıştırılır
async function runSelfUpdate() {
  if (!updateInfo || !account.isLoggedIn()) return { ok: false };
  const { DownloadTask } = require('./engine/task');
  const { createHttpTransport } = require('./engine/transport-http');
  const dir = path.join(app.getPath('userData'), 'update');
  const task = new DownloadTask({
    id: `update-${updateInfo.version}`, tempDir: path.join(dir, 'tmp'), dest: path.join(dir, `Master-Download-Setup-${updateInfo.version}.exe`),
    transport: createHttpTransport({ url: `${apiBase()}/api/${APP}/apps/${APP}/download?kind=setup`, headers: { Authorization: `Bearer ${account.token()}` }, resolveProxy: (u) => session.defaultSession.resolveProxy(u) }),
    connections: 4,
  });
  task.on('progress', (p) => send('app:updateProgress', { received: p.received, total: p.size }));
  task.on('error', () => {});
  await task.start();
  if (task.status !== 'completed') return { ok: false, code: (task.error && task.error.code) || 'error' };
  send('app:updateProgress', { phase: 'install' });
  spawn(task.dest, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(quitApp, 800);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('app:lang', (e) => { e.returnValue = currentLang(); });
ipcMain.handle('account:state', () => ({ ...account.state(), notice: loginNotice, appVersion: app.getVersion() }));
ipcMain.handle('account:login', async (_e, { email, password }) => {
  try {
    await account.login(email, password, true);
    loginNotice = '';
    if (loginWindow) loginWindow.close();
    createMainWindow();
    account.start();
    flushPendingAdds();
    checkUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code || 'error', message: e.message };
  }
});
ipcMain.handle('account:logout', async () => {
  await manager.pauseAll();
  await account.logout();
  closeMainAndShowLogin();
});
ipcMain.handle('account:openWeb', (_e, page) => {
  const allowed = { forgot: '/sifremi-unuttum', register: '/kayit', account: '/hesabim' };
  if (!allowed[page]) return;
  shell.openExternal(`${apiBase()}${allowed[page]}?${new URLSearchParams({ lang: currentLang(), theme: themeParam(), app: APP })}`);
});
ipcMain.handle('app:openPortal', () => shell.openExternal(`${apiBase()}/?${new URLSearchParams({ lang: currentLang(), theme: themeParam() })}`));

// İndirmeler
ipcMain.handle('dl:list', () => manager.list());
ipcMain.handle('dl:get', (_e, id) => { const it = manager.get(id); return it ? manager.view(it) : null; });
ipcMain.handle('dl:add', (_e, req) => {
  try {
    const it = manager.add({ ...req, start: !!req.start });
    if (req.start && store.settings.downloads.showProgress) openProgress(it.id);
    return { ok: true, item: it };
  } catch (e) {
    return { ok: false, code: e.code || 'error' };
  }
});
ipcMain.handle('dl:addMany', (_e, { items, queue, dir, start }) => {
  let n = 0;
  for (const x of items || []) {
    try { manager.add({ ...x, dir: dir || x.dir || '', queue: queue || null, start: false }); n++; } catch { /* geçersiz adres */ }
  }
  if (start && queue) manager.startQueue(queue);
  else if (start) manager.resumeAll();
  return { ok: true, added: n };
});
ipcMain.handle('dl:start', (_e, ids) => { for (const id of [].concat(ids)) manager.start(id); });
ipcMain.handle('dl:pause', (_e, ids) => Promise.all([].concat(ids).map((id) => manager.pause(id))));
ipcMain.handle('dl:pauseAll', () => manager.pauseAll());
ipcMain.handle('dl:remove', (_e, { ids, deleteFile }) => manager.remove(ids, { deleteFile }));
ipcMain.handle('dl:redownload', (_e, id) => manager.redownload(id));
ipcMain.handle('dl:refresh', (_e, { id, url }) => manager.refreshUrl(id, { url }));
ipcMain.handle('dl:update', (_e, { id, patch }) => manager.update(id, patch));
ipcMain.handle('dl:open', (_e, id) => { const it = manager.get(id); if (it && it.dest) return shell.openPath(it.dest); });
ipcMain.handle('dl:openWith', (_e, id) => {
  const it = manager.get(id);
  if (it && it.dest && process.platform === 'win32') spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', it.dest], { detached: true, stdio: 'ignore' }).unref();
});
ipcMain.handle('dl:reveal', (_e, id) => {
  const it = manager.get(id);
  if (!it) return;
  if (it.dest && fs.existsSync(it.dest)) shell.showItemInFolder(it.dest);
  else if (it.dir) shell.openPath(it.dir);
});
ipcMain.handle('dl:progressWindow', (_e, id) => openProgress(id));
ipcMain.handle('dl:moveToQueue', (_e, { ids, queue }) => manager.moveToQueue(ids, queue));
ipcMain.handle('dl:reorder', (_e, { queue, ids }) => manager.reorder(queue, ids));
ipcMain.handle('dl:copyUrl', (_e, id) => { const it = manager.get(id); if (it) clipboard.writeText(it.url); });
ipcMain.handle('dl:scan', (_e, id) => { const it = manager.get(id); if (it && it.dest) return scanFile(it); });
ipcMain.handle('dl:startOnDrag', (e, id) => {
  const it = manager.get(id);
  if (it && it.dest && fs.existsSync(it.dest)) e.sender.startDrag({ file: it.dest, icon: nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }) });
});

// Kuyruklar
ipcMain.handle('q:list', () => queueState());
ipcMain.handle('q:start', (_e, qid) => manager.startQueue(qid));
ipcMain.handle('q:stop', (_e, qid) => manager.stopQueue(qid));
ipcMain.handle('q:save', (_e, queues) => {
  if (!Array.isArray(queues) || !queues.some((q) => q.id === MAIN)) return queueState();
  store.settings.queues = queues.map((q) => ({
    id: String(q.id), name: String(q.name || '').slice(0, 60), maxParallel: Math.max(1, Math.min(32, Number(q.maxParallel) || 1)),
    schedule: { enabled: !!(q.schedule && q.schedule.enabled), start: (q.schedule && q.schedule.start) || '', stop: (q.schedule && q.schedule.stop) || '', days: ((q.schedule && q.schedule.days) || []).filter((d) => d >= 0 && d <= 6), once: !!(q.schedule && q.schedule.once) },
    after: ['none', 'exit', 'sleep', 'hibernate', 'shutdown'].includes(q.after) ? q.after : 'none',
  }));
  // Silinen kuyruktaki indirmeler kuyruktan çıkar
  const ids = new Set(store.settings.queues.map((q) => q.id));
  manager.moveToQueue(manager.items.filter((x) => x.queue && !ids.has(x.queue)).map((x) => x.id), null);
  saveStore();
  manager.runner.pump();
  return queueState();
});
ipcMain.handle('q:cancelAfter', () => { clearTimeout(afterTimer); afterTimer = null; });

// Toplu indirme, içe/dışa aktarma, site yakalayıcı
ipcMain.handle('batch:expand', (_e, { pattern, from, to, width, step }) => {
  try {
    return { ok: true, urls: pattern.includes('*') && from !== undefined && from !== '' ? expandPattern(pattern, { from: /^\d+$/.test(from) ? Number(from) : from, to: /^\d+$/.test(to) ? Number(to) : to, width: Number(width) || 0, step: Number(step) || 1 }) : expandPattern(pattern) };
  } catch (e) {
    return { ok: false, code: e.code || 'invalid_range' };
  }
});
ipcMain.handle('batch:clipboard', () => extractLinks(clipboard.readText()));
ipcMain.handle('io:import', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'IDM / Master Download', extensions: ['ef2', 'txt'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, count: await importFile(r.filePaths[0]) };
});
ipcMain.handle('io:importFile', (_e, file) => importFile(file));
ipcMain.handle('io:export', async (_e, { ids, format }) => {
  const items = (ids && ids.length ? ids.map((id) => manager.get(id)) : manager.items).filter(Boolean);
  const ef2 = format !== 'txt';
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: `master-download.${ef2 ? 'ef2' : 'txt'}`, filters: [{ name: ef2 ? 'IDM (.ef2)' : 'Text', extensions: [ef2 ? 'ef2' : 'txt'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  await fs.promises.writeFile(r.filePath, ef2 ? formatEf2(items.map((x) => ({ url: x.url, referrer: x.referrer, ua: x.ua, fileName: x.fileName }))) : formatList(items), 'utf8');
  return { ok: true, count: items.length };
});
let grabCtl = null;
ipcMain.handle('grab:start', async (_e, opts) => {
  if (grabCtl) grabCtl.abort();
  grabCtl = new AbortController();
  const signal = grabCtl.signal;
  try {
    const r = await grab({
      startUrl: opts.url, depth: Math.max(0, Math.min(5, Number(opts.depth) || 0)), exts: parseExts(opts.exts), scope: opts.scope || 'host',
      maxPages: Math.max(1, Math.min(2000, Number(opts.maxPages) || 200)), delayMs: 300, signal,
      fetchText: (u) => fetchText(u, { userAgent: store.settings.connection.userAgent || undefined, resolveProxy: (x) => session.defaultSession.resolveProxy(x), timeout: 20000 }, 4 * 1024 * 1024),
      onProgress: (p) => send('grab:progress', p),
    });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, code: e.code || 'error', message: e.message };
  } finally {
    grabCtl = null;
  }
});
ipcMain.handle('grab:stop', () => { if (grabCtl) grabCtl.abort(); });

// Klasör seçimi
ipcMain.handle('ui:pickDir', async (e, current) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'], defaultPath: current || store.settings.downloads.dir });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('ui:pickFile', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'exe', extensions: ['exe', 'com', 'bat', 'cmd'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('ui:dropText', (_e, text) => {
  const links = extractLinks(text);
  if (links.length === 1) return requestAdd({ url: links[0] });
  if (links.length > 1) { showMainWindow(); sendWhenReady('dl:batchDialog', { items: links.map((url) => ({ url })) }); }
  return { ok: links.length > 0 };
});
ipcMain.handle('ui:closeWindow', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
ipcMain.handle('ui:showMain', () => showMainWindow());

// Ayarlar
const SETTINGS_KEYS = ['appTheme', 'language', 'openAtLogin', 'minimizeToTray', 'closeToTray', 'checkUpdates', 'connection', 'downloads', 'speedLimit', 'browser', 'clipboard', 'categories', 'columns'];
ipcMain.handle('settings:get', () => ({ ...store.settings, defaults: { downloadsDir: defaultSettings().downloads.dir, exts: DEFAULT_EXTS } }));
ipcMain.handle('settings:set', (_e, patch) => {
  const s = store.settings;
  for (const k of Object.keys(patch || {})) {
    if (!SETTINGS_KEYS.includes(k)) continue;
    s[k] = patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) ? deepMerge(s[k], patch[k]) : patch[k];
  }
  s.connection.maxConnections = Math.max(1, Math.min(32, Number(s.connection.maxConnections) || 8));
  saveStore();
  if ('openAtLogin' in patch) applyOpenAtLogin();
  if ('appTheme' in patch) applyAppTheme();
  if ('speedLimit' in patch) manager && manager.applySpeedLimit();
  if ('language' in patch) {
    applyLanguage();
    updateTray();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
  }
  updateTray();
  return s;
});
ipcMain.handle('browser:register', () => registerNativeHost());
ipcMain.handle('browser:openStore', (_e, which) => {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(ROOT, 'extension', 'dist');
  if (which === 'folder') return shell.openPath(fs.existsSync(dir) ? dir : ROOT);
  const urls = { chrome: 'chrome://extensions', edge: 'edge://extensions', firefox: 'about:debugging#/runtime/this-firefox' };
  if (urls[which]) clipboard.writeText(urls[which]);
  return urls[which] || null;
});

function applyOpenAtLogin() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.settings.openAtLogin, args: ['--hidden'] });
}

ipcMain.handle('app:about', () => ({
  version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
  openAtLogin: app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : !!store.settings.openAtLogin,
}));
ipcMain.handle('app:checkUpdate', async () => {
  try { return { ok: true, ...(await checkUpdate({ manual: true })) }; } catch (e) { return { ok: false, code: e.code || 'error', message: e.message }; }
});
ipcMain.handle('app:selfUpdate', () => runSelfUpdate());
ipcMain.handle('app:openLicenses', () => {
  const file = path.join(path.dirname(process.execPath), 'LICENSES.chromium.html');
  if (fs.existsSync(file)) return shell.openPath(file);
  return shell.openExternal('https://www.electronjs.org/docs/latest#license');
});
ipcMain.handle('app:quit', () => quitApp());
ipcMain.handle('app:dropTarget', (_e, show) => toggleDropTarget(show));

// ---------------------------------------------------------------------------
app.setAppUserModelId('com.mastertool.masterdownload');

app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e) => e.preventDefault());
});

// Tek örnek: ikinci kez başlatılınca (ör. "Birlikte aç", komut satırı /d) argümanlar bu örneğe gelir
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!account) return;
    if (!handleCli(argv.slice(1))) showMainWindow();
  });
  app.on('before-quit', (e) => {
    if (manager && !isQuitting) { e.preventDefault(); quitApp(); }
  });

  app.whenReady().then(async () => {
    loadStore();
    fs.mkdirSync(tempDir(), { recursive: true });
    initAccount();
    initManager();
    createTray();
    initBridge();
    registerNativeHost();
    if (account.sharedEndedWhileClosed()) loginNotice = t('auth.signedOutElsewhere');
    if (!account.isLoggedIn()) {
      const r = await account.loginWithShared();
      if (!r.ok && r.code === 'app_disabled') loginNotice = t('auth.errAppDisabled');
    }
    account.watchShared();
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    const hidden = args.includes('--hidden') && store.settings.minimizeToTray;
    if (account.isLoggedIn()) {
      createMainWindow({ show: !hidden });
      account.start();
      checkUpdate();
      handleCli(args);
    } else {
      createLoginWindow();
      const o = parseArgs(args);
      if (o.url) pendingAdds.push({ url: o.url, dir: o.dir || '', filename: o.fileName || '', silent: o.silent });
    }
    if (store.settings.dropTarget.show) toggleDropTarget(true);
  });

  // Tepsi her zaman açık kalır; çıkış yalnız tepsi menüsünden / Ayarlar'dan
  app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
  app.on('will-quit', () => { if (account) account.stopShared(); if (bridge) bridge.close(); });
}
