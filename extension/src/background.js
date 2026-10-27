/* Master Download eklentisi — arka plan.
 * Chromium: MV3 service worker (rules.js importScripts ile yüklenir).
 * Firefox: background.scripts ["rules.js", "background.js"] (olay sayfası).
 * Tüm dinleyiciler üst düzeyde, eşzamanlı kaydedilir (service worker uyandığında olay kaçmasın diye). */
'use strict';

/* global importScripts */
if (typeof importScripts === 'function' && !globalThis.MDRules) importScripts('rules.js');

const B = globalThis.browser || globalThis.chrome;
const R = globalThis.MDRules;

const HOST = 'com.mastertool.masterdownload';
const NATIVE_TIMEOUT_MS = 5000;   // host yanıt vermezse indirme tarayıcıya geri verilir
const MOD_WINDOW_MS = 1500;       // Alt/Ctrl bırakıldıktan sonra da bu süre "basılı" sayılır
const BYPASS_MS = 60000;          // tarayıcıya geri verilen adres bu süre içinde bir kez yakalanmaz
const MAX_MEDIA_PER_TAB = 50;

const t = (key, subs) => (B.i18n && B.i18n.getMessage(key, subs)) || key;

// ---------------------------------------------------------------- ayarlar
let settings = R.normalizeSettings({});
const settingsReady = (async () => {
  try {
    const o = await B.storage.local.get('settings');
    settings = R.normalizeSettings(o && o.settings);
  } catch (e) { /* varsayılanlar */ }
})();
B.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.settings) settings = R.normalizeSettings(ch.settings.newValue);
});

// ---------------------------------------------------------------- değiştirici tuşlar
// İçerik betiği Alt/Ctrl durumunu bildirir; indirme olayı geldiğinde "son 1,5 sn içinde basılı mıydı" bakılır.
const mods = { alt: false, altAt: 0, ctrl: false, ctrlAt: 0 };
function setMods(m) {
  const now = Date.now();
  if (typeof m.alt === 'boolean') { if (m.alt || mods.alt) mods.altAt = now; mods.alt = m.alt; }
  if (typeof m.ctrl === 'boolean') { if (m.ctrl || mods.ctrl) mods.ctrlAt = now; mods.ctrl = m.ctrl; }
}
const altDown = () => mods.alt || Date.now() - mods.altAt < MOD_WINDOW_MS;
const ctrlDown = () => mods.ctrl || Date.now() - mods.ctrlAt < MOD_WINDOW_MS;

// Son tıklanan bağlantının sayfası (indirmeye sayfa adresi/başlığı eklemek için)
let lastClick = null; // { url, pageUrl, title, t }

// ---------------------------------------------------------------- native messaging
async function sendNative(msg, timeoutMs = NATIVE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: 'timeout' }), timeoutMs); });
  const call = (async () => {
    try {
      const r = await B.runtime.sendNativeMessage(HOST, msg);
      if (!r || typeof r !== 'object') return { ok: false, code: 'no_response' };
      return r;
    } catch (e) {
      return { ok: false, code: 'host_error', detail: String((e && e.message) || e) };
    }
  })();
  try { return await Promise.race([call, timeout]); } finally { clearTimeout(timer); }
}

async function cookiesFor(url) {
  try { return R.cookieHeader(await B.cookies.getAll({ url })); } catch (e) { return ''; }
}

async function buildAdd({ url, referrer, filename, size, mime, kind, pageUrl, title }) {
  return {
    v: 1, type: 'add', url,
    referrer: referrer || '',
    cookies: await cookiesFor(url),
    ua: (globalThis.navigator && navigator.userAgent) || '',
    filename: filename || '',
    size: Number(size) > 0 ? Number(size) : 0,
    mime: mime || '',
    kind: kind || 'file',
    pageUrl: pageUrl || '',
    title: title || '',
  };
}

function notify(title, message) {
  try {
    const p = B.notifications.create({ type: 'basic', iconUrl: B.runtime.getURL('icons/icon-128.png'), title, message });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* bildirim izni yoksa sessiz */ }
}

function errorText(res) {
  const code = (res && res.code) || 'unknown';
  if (code === 'blocked') return t('errBlocked');
  if (code === 'app_unavailable' || code === 'timeout' || code === 'host_error' || code === 'no_response') return t('errAppUnavailable');
  return t('errGeneric', [code]);
}

// ---------------------------------------------------------------- indirme yakalama
const bypass = new Map(); // adres → son geçerlilik zamanı
function bypassHas(url) {
  const now = Date.now();
  for (const [u, exp] of bypass) if (exp < now) bypass.delete(u);
  if (bypass.has(url)) { bypass.delete(url); return true; }
  return false;
}

async function activeTabInfo() {
  try {
    const [tab] = await B.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ? { pageUrl: tab.url || '', title: tab.title || '' } : {};
  } catch (e) { return {}; }
}

// Yakalanan indirmeyi tarayıcıdan kaldırıp uygulamaya ver; olmazsa tarayıcıya geri ver
async function handOff(item, filename, forced) {
  const url = item.finalUrl || item.url;
  try { await B.downloads.cancel(item.id); } catch (e) { /* zaten bitmiş olabilir */ }
  try { await B.downloads.erase({ id: item.id }); } catch (e) { /* yoksay */ }
  let page = {};
  if (lastClick && Date.now() - lastClick.t < 10000 && (lastClick.url === url || lastClick.url === item.url)) page = lastClick;
  else page = await activeTabInfo();
  const msg = await buildAdd({
    url, referrer: item.referrer || page.pageUrl || '', filename: R.fileNameOf(filename || ''),
    size: item.totalBytes > 0 ? item.totalBytes : item.fileSize, mime: item.mime, kind: 'file',
    pageUrl: page.pageUrl, title: page.title,
  });
  if (forced) msg.forced = true;
  const res = await sendNative(msg);
  if (!res.ok) giveBack(url, res);
}

function giveBack(url, res) {
  notify(t('notifyFallbackTitle'), `${errorText(res)}\n${t('notifyFallbackBody')}`);
  bypass.set(url, Date.now() + BYPASS_MS);
  Promise.resolve(B.downloads.download({ url })).catch(() => bypass.delete(url));
}

// onCreated'te dosya adı henüz belli değilse (Chromium) onDeterminingFilename'de yeniden bakılır
const pendingDecision = new Map(); // indirme kimliği → { alt, ctrl, t }

function decide(item, filename, alt, ctrl) {
  const url = item.finalUrl || item.url;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize;
  return R.shouldCapture(url, size, settings, alt, ctrl, filename);
}

B.downloads.onCreated.addListener(async (item) => {
  await settingsReady;
  if (!item || (item.state && item.state !== 'in_progress')) return;
  if (B.runtime.id && item.byExtensionId === B.runtime.id) return; // kendi geri verdiğimiz indirme
  const url = item.finalUrl || item.url;
  if (bypassHas(url) || (item.url !== url && bypassHas(item.url))) return;
  const alt = altDown();
  const ctrl = ctrlDown();
  if (decide(item, item.filename, alt, ctrl)) { handOff(item, item.filename, ctrl); return; }
  // Adreste uzantı yok ve dosya adı henüz belli değil: Chromium'da ad belirlenince tekrar bak
  if (!alt && !item.filename && B.downloads.onDeterminingFilename) pendingDecision.set(item.id, { alt, ctrl, t: Date.now() });
});

if (B.downloads.onDeterminingFilename) {
  B.downloads.onDeterminingFilename.addListener((item, suggest) => {
    suggest(); // adı değiştirmiyoruz; tarayıcı beklemesin
    const p = pendingDecision.get(item.id);
    if (!p) return;
    pendingDecision.delete(item.id);
    if (Date.now() - p.t > 30000) return;
    if (decide(item, item.filename, p.alt, p.ctrl)) handOff(item, item.filename, p.ctrl);
  });
}

// ---------------------------------------------------------------- medya algılama (yalnız gözlem)
const tabs = new Map(); // tabId → { items: [{url, kind, mime, size, filename, t}], eme: bool }
const hasSession = !!(B.storage && B.storage.session);
const mediaReady = (async () => {
  if (!hasSession) return;
  try {
    const o = await B.storage.session.get('media');
    for (const [id, v] of Object.entries((o && o.media) || {})) if (!tabs.has(+id)) tabs.set(+id, v);
  } catch (e) { /* yoksay */ }
})();
let saveTimer = null;
function saveMedia() {
  if (!hasSession || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const o = {};
    for (const [id, v] of tabs) o[id] = v;
    Promise.resolve(B.storage.session.set({ media: o })).catch(() => {});
  }, 500);
}
function tabState(tabId) {
  let s = tabs.get(tabId);
  if (!s) { s = { items: [], eme: false }; tabs.set(tabId, s); }
  return s;
}
function setBadge(tabId) {
  const s = tabs.get(tabId);
  const n = s && !s.eme ? s.items.length : 0;
  try {
    const a = B.action || B.browserAction;
    Promise.resolve(a.setBadgeText({ tabId, text: n ? String(n) : '' })).catch(() => {});
    Promise.resolve(a.setBadgeBackgroundColor({ tabId, color: '#6366f1' })).catch(() => {});
  } catch (e) { /* yoksay */ }
}
function clearTab(tabId) {
  if (tabs.delete(tabId)) { saveMedia(); setBadge(tabId); }
}

function header(headers, name) {
  const h = (headers || []).find((x) => x.name && x.name.toLowerCase() === name);
  return h ? (h.value || '') : '';
}
function dispositionName(v) {
  if (!v) return '';
  let m = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(v);
  if (m) { try { return decodeURIComponent(m[1].trim()); } catch (e) { /* aşağıdaki */ } }
  m = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(v);
  return m ? (m[1] || m[2] || '').trim() : '';
}

B.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0) return;
  if (d.statusCode && d.statusCode !== 200 && d.statusCode !== 206) return;
  const mime = header(d.responseHeaders, 'content-type');
  const kind = R.detectKind(d.url, mime);
  if (!kind) return;
  let size = Number(header(d.responseHeaders, 'content-length')) || 0;
  const range = /\/(\d+)\s*$/.exec(header(d.responseHeaders, 'content-range'));
  if (range) size = Number(range[1]);
  if (!R.isMediaWorthy(kind, size)) return;
  const pageUrl = d.initiator || d.documentUrl || d.originUrl || '';
  if (R.isBlockedSite(R.hostOf(d.url)) || (pageUrl && R.isBlockedSite(R.hostOf(pageUrl)))) return;
  const s = tabState(d.tabId);
  const i = s.items.findIndex((x) => x.url === d.url);
  const rec = {
    url: d.url, kind, mime: mime.split(';')[0].trim(), size: size > 0 ? size : 0,
    filename: dispositionName(header(d.responseHeaders, 'content-disposition')) || R.fileNameOf(d.url), t: Date.now(),
  };
  if (i >= 0) s.items.splice(i, 1);
  s.items.push(rec);
  if (s.items.length > MAX_MEDIA_PER_TAB) s.items.splice(0, s.items.length - MAX_MEDIA_PER_TAB);
  saveMedia();
  setBadge(d.tabId);
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

B.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) clearTab(tabId); // yeni sayfaya gezinme
});
B.tabs.onRemoved.addListener((tabId) => clearTab(tabId));

async function tabInfo(tabId) {
  try { return await B.tabs.get(tabId); } catch (e) { return null; }
}

async function mediaFor(tabId) {
  await mediaReady;
  const tab = await tabInfo(tabId);
  const s = tabs.get(tabId) || { items: [], eme: false };
  const blocked = !!(tab && tab.url && R.isBlockedSite(R.hostOf(tab.url)));
  const hidden = blocked || s.eme;
  return {
    pageUrl: (tab && tab.url) || '', title: (tab && tab.title) || '',
    blocked, eme: !!s.eme,
    items: hidden ? [] : s.items.slice().reverse(), // en yeni üstte
  };
}

async function sendMedia(tabId, item) {
  if (!item || !item.url) return { ok: false, code: 'bad_request' };
  const m = await mediaFor(tabId);
  if (m.blocked || m.eme || R.isBlockedSite(R.hostOf(item.url))) return { ok: false, code: 'blocked' };
  const kind = item.kind === 'hls' || item.kind === 'dash' ? item.kind : 'file';
  const msg = await buildAdd({
    url: item.url, referrer: m.pageUrl, filename: item.filename || '', size: item.size, mime: item.mime,
    kind, pageUrl: m.pageUrl, title: m.title,
  });
  return sendNative(msg);
}

// ---------------------------------------------------------------- toplu bağlantılar
async function collectLinks(tabId, frameId, selectionOnly) {
  try {
    const r = await B.tabs.sendMessage(tabId, { type: 'collectLinks', selection: !!selectionOnly }, { frameId: frameId || 0 });
    if (Array.isArray(r)) return r;
  } catch (e) { /* içerik betiği yok (ör. sekme eklentiden önce açılmış) */ }
  try {
    const res = await B.scripting.executeScript({
      target: { tabId, frameIds: [frameId || 0] },
      args: [!!selectionOnly],
      func: (sel) => {
        const s = window.getSelection();
        return Array.from(document.querySelectorAll('a[href]'))
          .filter((a) => !sel || (s && s.rangeCount && s.containsNode(a, true)))
          .map((a) => ({ url: a.href, filename: a.getAttribute('download') || '' }));
      },
    });
    return (res && res[0] && res[0].result) || [];
  } catch (e) { return []; }
}

async function addMany(links, pageUrl) {
  const seen = new Set();
  const items = [];
  for (const l of links || []) {
    const p = R.parseUrl(l && l.url);
    if (!p || R.CAPTURE_PROTOCOLS.indexOf(p.protocol) < 0) continue;
    p.hash = '';
    const url = p.href;
    if (seen.has(url)) continue;
    seen.add(url);
    const it = { url, referrer: pageUrl || '' };
    if (l.filename) it.filename = String(l.filename);
    items.push(it);
    if (items.length >= 5000) break;
  }
  if (!items.length) return { ok: false, code: 'no_links' };
  const msg = { v: 1, type: 'addMany', items, referrer: pageUrl || '' };
  // Çerezler yalnız tüm bağlantılar aynı sitedeyse eklenir (başka sitelere sızmasın)
  const hosts = new Set(items.map((i) => R.hostOf(i.url)));
  if (hosts.size === 1) {
    const c = await cookiesFor(items[0].url);
    if (c) msg.cookies = c;
  }
  return sendNative(msg);
}

async function collectAndSend(tabId, frameId, selectionOnly) {
  const tab = await tabInfo(tabId);
  const links = await collectLinks(tabId, frameId, selectionOnly);
  const res = await addMany(links, tab && tab.url);
  if (!res.ok) notify(t('extName'), res.code === 'no_links' ? t('noLinks') : errorText(res));
  return res;
}

// ---------------------------------------------------------------- sağ tık menüsü
async function setupMenus() {
  try {
    await B.contextMenus.removeAll();
    B.contextMenus.create({ id: 'md-link', title: t('menuLink'), contexts: ['link'] });
    B.contextMenus.create({ id: 'md-all', title: t('menuAll'), contexts: ['page', 'selection'] });
    B.contextMenus.create({ id: 'md-media', title: t('menuMedia'), contexts: ['video', 'audio'] });
  } catch (e) { /* yoksay */ }
}
B.runtime.onInstalled.addListener(setupMenus);
if (B.runtime.onStartup) B.runtime.onStartup.addListener(setupMenus);

B.contextMenus.onClicked.addListener(async (info, tab) => {
  await settingsReady;
  const tabId = tab ? tab.id : -1;
  if (info.menuItemId === 'md-link') {
    const url = info.linkUrl;
    const res = await sendNative(await buildAdd({
      url, referrer: info.pageUrl || '', filename: '', kind: R.detectKind(url, '') === 'hls' ? 'hls' : R.detectKind(url, '') === 'dash' ? 'dash' : 'file',
      pageUrl: info.pageUrl || '', title: (tab && tab.title) || '',
    }));
    if (!res.ok) notify(t('extName'), errorText(res));
  } else if (info.menuItemId === 'md-all') {
    if (tabId >= 0) await collectAndSend(tabId, info.frameId, !!info.selectionText);
  } else if (info.menuItemId === 'md-media') {
    if (tabId < 0) return;
    const m = await mediaFor(tabId);
    if (m.blocked || m.eme) { notify(t('extName'), t('errBlocked')); return; }
    const src = info.srcUrl || '';
    const p = R.parseUrl(src);
    if (p && (p.protocol === 'http:' || p.protocol === 'https:')) {
      if (R.isBlockedSite(p.hostname)) { notify(t('extName'), t('errBlocked')); return; }
      const known = m.items.find((x) => x.url === src);
      const res = await sendMedia(tabId, known || { url: src, kind: R.detectKind(src, '') || 'file', filename: R.fileNameOf(src) });
      if (!res.ok) notify(t('extName'), errorText(res));
      return;
    }
    // blob:/MediaSource: oynatıcı akışı parça parça besliyor; algılanan liste/dosyalardan seçilir
    const streams = m.items.filter((x) => x.kind !== 'file');
    const cands = streams.length ? streams : m.items;
    if (!cands.length) { notify(t('extName'), t('noMedia')); return; }
    if (cands.length > 1) {
      try {
        const shown = await B.tabs.sendMessage(tabId, { type: 'showChooser' }, { frameId: info.frameId || 0 });
        if (shown) return;
      } catch (e) { /* içerik betiği yok: en yenisini gönder */ }
    }
    const res = await sendMedia(tabId, cands[0]);
    if (!res.ok) notify(t('extName'), errorText(res));
  }
});

// ---------------------------------------------------------------- iletiler (içerik betiği, açılır pencere, seçenekler)
async function handleMessage(msg, sender) {
  const senderTab = sender && sender.tab ? sender.tab.id : -1;
  const tabId = typeof msg.tabId === 'number' ? msg.tabId : senderTab;
  switch (msg.type) {
    case 'mod': setMods(msg); return { ok: true };
    case 'click':
      setMods(msg);
      if (msg.url) lastClick = { url: msg.url, pageUrl: (sender.tab && sender.tab.url) || msg.pageUrl || '', title: (sender.tab && sender.tab.title) || '', t: Date.now() };
      return { ok: true };
    case 'eme':
      if (tabId >= 0) { tabState(tabId).eme = true; saveMedia(); setBadge(tabId); }
      return { ok: true };
    case 'getMedia':
      return tabId >= 0 ? mediaFor(tabId) : { items: [], blocked: false, eme: false };
    case 'sendMedia':
      return sendMedia(tabId, msg.item);
    case 'collectAll':
      return tabId >= 0 ? collectAndSend(tabId, 0, false) : { ok: false, code: 'bad_request' };
    case 'forceAdd': {
      // Ctrl ile tıklanan bağlantı: koşullara bakmadan uygulamaya ver
      const p = R.parseUrl(msg.url);
      if (!p || R.CAPTURE_PROTOCOLS.indexOf(p.protocol) < 0) return { ok: false, code: 'bad_request' };
      const pageUrl = (sender.tab && sender.tab.url) || '';
      const res = await sendNative(await buildAdd({
        url: msg.url, referrer: pageUrl, filename: msg.filename || '', kind: 'file', pageUrl, title: (sender.tab && sender.tab.title) || '',
      }));
      if (!res.ok) giveBack(msg.url, res);
      return res;
    }
    case 'ping':
      return sendNative({ v: 1, type: 'ping' });
    default:
      return null;
  }
}

B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  Promise.resolve(handleMessage(msg, sender || {}))
    .then((r) => sendResponse(r), () => sendResponse({ ok: false, code: 'internal' }));
  return true;
});
