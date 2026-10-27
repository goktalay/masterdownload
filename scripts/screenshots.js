// 1600×1000 ekran görüntüleri (gece + gündüz) ve manifest.json üretir: Türkçe set docs/screenshots/,
// İngilizce set docs/screenshots/en/ (aynı dosya adları).
// Arayüz gerçek dosyalardan (src/renderer) yüklenir; window.api örnek verilerle taklit edilir — gerçek hesap,
// sunucu, adres ya da kişisel veri kullanılmaz (adresler example.com/example.org).
//
// Kullanım: npm run screenshots   (Chromium yolu: CHROMIUM_PATH ya da Playwright'ın varsayılanı)
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT_BASE = path.join(ROOT, 'docs', 'screenshots');
const I18N = require('../src/i18n');
const { defaultCategories } = require('../src/engine/categories');
const W = 1600;
const H = 1000;
const MB = 1048576;
const NOW = new Date(2026, 9, 27, 14, 32).getTime();

const SAMPLE = {
  tr: {
    email: 'ornek@example.com', name: 'Örnek Kullanıcı', winUser: 'Ornek', password: 'örnekşifre', locale: 'tr-TR',
    files: ['Ornek-Kurulum-2.4.1.exe', 'tatil-videosu-1080p.mp4', 'yillik-rapor-2026.pdf', 'fotograflar-ekim.zip', 'podcast-bolum-12.mp3', 'proje-yedek.7z', 'egitim-sunumu.pptx', 'harita-verisi.tar.gz'],
    queue2: 'Gece indirmeleri', desc: 'Kurulum dosyası',
  },
  en: {
    email: 'sample@example.com', name: 'Sample User', winUser: 'Sample', password: 'samplepass', locale: 'en-US',
    files: ['Sample-Setup-2.4.1.exe', 'holiday-video-1080p.mp4', 'annual-report-2026.pdf', 'photos-october.zip', 'podcast-episode-12.mp3', 'project-backup.7z', 'training-slides.pptx', 'map-data.tar.gz'],
    queue2: 'Night downloads', desc: 'Setup file',
  },
};

// Örnek indirme listesi; segs: bölüm başına tamamlanma oranı (etkin olanlar a)
function demo(lang) {
  const S = SAMPLE[lang];
  const f = S.files;
  const dir = `C:\\Users\\${S.winUser}\\Downloads\\Master Download`;
  const t = I18N.createT(lang);
  const catDir = (c) => `${dir}\\${t(`cat.${c}`)}`;
  const mk = (i, o) => ({
    id: `d${i}`, url: o.url, kind: o.kind || 'file', fileName: f[i], category: o.cat, dir: catDir(o.cat), dest: `${catDir(o.cat)}\\${f[i]}`,
    queue: o.queue || null, order: i, size: o.size, received: o.received ?? o.size, resumable: o.resumable ?? true, status: o.status,
    error: o.error || null, addedAt: NOW - o.ago * 60000, finishedAt: o.status === 'completed' ? NOW - (o.ago - 3) * 60000 : null,
    description: o.desc || '', speedLimit: 0, hasCookies: false, progress: null,
  });
  const items = [
    mk(1, { url: 'https://media.example.com/videos/holiday-1080p.mp4', cat: 'video', size: 1843 * MB, received: 1187 * MB, status: 'downloading', ago: 6 }),
    mk(0, { url: 'https://downloads.example.com/releases/sample-setup-2.4.1.exe', cat: 'programs', size: 312 * MB, received: 74 * MB, status: 'downloading', ago: 3, desc: S.desc }),
    mk(5, { url: 'https://files.example.org/backup/project-backup.7z', cat: 'compressed', size: 4.6 * 1024 * MB, received: 1.1 * 1024 * MB, status: 'queued', queue: 'night', ago: 25 }),
    mk(7, { url: 'https://data.example.org/maps/map-data.tar.gz', cat: 'compressed', size: 2.2 * 1024 * MB, received: 0, status: 'queued', queue: 'night', ago: 24 }),
    mk(3, { url: 'https://photos.example.com/share/photos-october.zip', cat: 'compressed', size: 845 * MB, received: 845 * MB, status: 'completed', ago: 70 }),
    mk(2, { url: 'https://docs.example.com/reports/annual-report-2026.pdf', cat: 'documents', size: 18.4 * MB, status: 'completed', ago: 95 }),
    mk(4, { url: 'https://cdn.example.org/podcast/episode-12.mp3', cat: 'music', size: 64.2 * MB, received: 21 * MB, status: 'paused', ago: 130, resumable: true }),
    mk(6, { url: 'https://share.example.com/slides/training.pptx', cat: 'documents', size: 27.9 * MB, received: 0, status: 'error', error: 'forbidden', ago: 160 }),
  ];
  const segs = (size, rec, n, act) => {
    const step = Math.ceil(size / n);
    const out = [];
    let left = rec;
    for (let i = 0; i < n; i++) {
      const start = i * step, end = Math.min(size - 1, start + step - 1);
      const take = Math.min(end - start + 1, Math.round(left / (n - i) * (0.75 + (i % 3) * 0.18)));
      left -= take;
      out.push({ id: i, start, end, pos: start + Math.max(0, take), active: i < act });
    }
    return out;
  };
  const progress = {
    d1: { id: 'd1', received: 1187 * MB, size: 1843 * MB, speed: 6.8 * MB, eta: Math.round((656 * MB) / (6.8 * MB)), connections: 8, segments: segs(1843 * MB, 1187 * MB, 8, 8) },
    d0: { id: 'd0', received: 74 * MB, size: 312 * MB, speed: 3.1 * MB, eta: Math.round((238 * MB) / (3.1 * MB)), connections: 8, segments: segs(312 * MB, 74 * MB, 8, 8) },
  };
  for (const it of items) if (progress[it.id]) it.progress = progress[it.id];
  const queues = [
    { id: 'main', name: '', maxParallel: 2, schedule: { enabled: false, start: '02:00', stop: '', days: [], once: false }, after: 'none', running: false, next: null },
    { id: 'night', name: S.queue2, maxParallel: 2, schedule: { enabled: true, start: '01:30', stop: '07:00', days: [1, 2, 3, 4, 5], once: false }, after: 'sleep', running: false, next: new Date(2026, 9, 28, 1, 30).getTime() },
  ];
  const settings = {
    appTheme: 'system', language: lang, openAtLogin: true, minimizeToTray: true, closeToTray: true, checkUpdates: true,
    connection: { maxConnections: 8, retries: 20, timeoutSec: 30, userAgent: '', proxy: { mode: 'system', host: '', port: '', user: '', pass: '' } },
    downloads: { dir, tempDir: '', duplicate: 'rename', showStartDialog: true, showProgress: true, showComplete: true, notify: true, sound: false, virusScan: true, scanner: 'defender', scannerPath: '', scannerArgs: '"[File]"', motw: true, resumeOnStart: false },
    speedLimit: { enabled: false, kbps: 2048 },
    browser: { enabled: true, exts: ['zip', 'rar', '7z', 'gz', 'iso', 'exe', 'msi', 'pdf', 'docx', 'xlsx', 'mp3', 'flac', 'mp4', 'mkv', 'avi', 'mov'], minSizeKB: 0, skipSites: ['intranet.example.com'], videoButton: true },
    clipboard: { watch: false }, dropTarget: { show: false },
    categories: defaultCategories(), queues, columns: ['name', 'size', 'status', 'speed', 'eta', 'added'],
    defaults: { downloadsDir: dir, exts: [] },
  };
  return { items, queues, settings, progress };
}

// window.api taklidi (preload.js ile aynı yüzey)
function stubScript(lang) {
  const S = SAMPLE[lang];
  const D = demo(lang);
  const grabFiles = ['setup-x64.zip', 'setup-arm64.zip', 'manual.pdf', 'drivers-2026.7z', 'changelog.pdf', 'tools.zip', 'samples.zip']
    .map((n) => ({ url: `https://downloads.example.com/files/${n}`, ext: n.split('.').pop(), page: 'https://downloads.example.com/files/' }));
  return `(() => {
    const D = ${JSON.stringify(D)};
    const noop = () => () => {};
    const inv = (v) => async () => v;
    window.api = {
      lang: ${JSON.stringify(lang)},
      accountState: async () => ({ loggedIn: true, email: ${JSON.stringify(S.email)}, user: { id: 1, name: ${JSON.stringify(S.name)} }, notice: null, appVersion: '0.1.0' }),
      login: async () => ({ ok: false }), logout: inv(), openWeb: inv(), openPortal: inv(), onAccount: noop,
      list: async () => D.items, get: async (id) => D.items.find((x) => x.id === id) || null,
      add: async () => ({ ok: true, item: {} }), addMany: async () => ({ ok: true, added: 0 }),
      start: inv(), pause: inv(), pauseAll: inv(), remove: inv(), redownload: inv(), refreshUrl: inv(true), update: inv(null),
      open: inv(), openWith: inv(), reveal: inv(), progressWindow: inv(), moveToQueue: inv(), reorder: inv(), copyUrl: inv(), scan: inv(), startDrag: inv(),
      onList: noop, onProgress: noop, onWarning: noop, onScan: noop, onAddDialog: noop, onBatchDialog: noop, onAfter: noop,
      queues: async () => D.queues, startQueue: inv(), stopQueue: inv(), saveQueues: async (q) => q, cancelAfter: inv(), onQueues: noop,
      expand: async ({ pattern, from, to, width }) => {
        const a = Number(from), b = Number(to), out = [];
        if (!pattern.includes('*') || !(b >= a)) return { ok: true, urls: [] };
        for (let n = a; n <= b && out.length < 500; n++) out.push(pattern.replace('*', String(n).padStart(Number(width) || 0, '0')));
        return { ok: true, urls: out };
      },
      clipboardLinks: inv([]), importList: inv({ ok: false }), importFile: inv(0), exportList: inv({ ok: false }),
      grab: async () => ({ ok: true, files: ${JSON.stringify(grabFiles)}, pages: 14, skipped: ['x'] }), grabStop: inv(), onGrab: noop,
      pickDir: inv(null), pickFile: inv(null), dropText: inv({ ok: true }), filePath: (f) => f.name, closeWindow: inv(), showMain: inv(),
      onPwProgress: (cb) => { const id = new URLSearchParams(location.search).get('id'); if (D.progress[id]) setTimeout(() => cb(D.progress[id]), 50); return () => {}; },
      onPwState: noop,
      getSettings: async () => D.settings, setSettings: async () => D.settings, onSettings: noop,
      registerBrowser: inv({ ok: true }), browserStore: inv(null), dropTarget: inv(),
      about: async () => ({ version: '0.1.0', electron: '33.4.11', chrome: '130.0.6723.191', openAtLogin: true }),
      checkUpdate: async () => ({ ok: true, newer: false }), selfUpdate: inv({ ok: true }), openLicenses: inv(), quit: inv(),
      onUpdateAvailable: noop, onUpdateProgress: noop,
    };
  })();`;
}

// Başlık ve açıklamalar (≤ 80 karakter); dosya adları iki dilde aynı
const TEXT = {
  tr: {
    list: ['İndirmeler', 'Kategoriler, kuyruklar, hız ve kalan süre; seçili indirmenin bölüm haritası'],
    add: ['Yeni indirme', 'Adres, dosya adı, kategori klasörü, kuyruk ve bağlantı sayısı; şimdi ya da sonra'],
    progress: ['İndirme ilerleme penceresi', '8 bağlantı aynı anda: bölüm haritası, bağlantı tablosu, dosya başına hız sınırı'],
    queues: ['Kuyruklar ve zamanlayıcı', 'Başlama/durma saati, günler, eşzamanlı indirme; bitince uyku ya da kapat'],
    grabber: ['Site yakalayıcı', 'Bir siteden belirli türdeki dosyaları toplar; robots.txt kurallarına uyar'],
    batch: ['Toplu indirme', 'Joker kalıpla numaralı dosyalar: dosya*.zip, 1–50, 3 basamak'],
    connection: ['Ayarlar › Bağlantı', 'Bağlantı sayısı, yeniden deneme, zaman aşımı, kullanıcı aracısı ve proxy'],
    browser: ['Ayarlar › Tarayıcı bütünleşmesi', 'Chrome, Edge ve Firefox eklentisi: indirmeleri yakalar, video düğmesi'],
    login: ['Tek giriş', 'Mastertool hesabıyla bir kez girin; ailenin diğer uygulamaları yeniden sormaz'],
  },
  en: {
    list: ['Downloads', 'Categories, queues, speed and time left; segment map of the selected download'],
    add: ['New download', 'Address, file name, category folder, queue and connections; now or later'],
    progress: ['Download progress window', '8 connections at once: segment map, connection table, per-file speed limit'],
    queues: ['Queues and scheduler', 'Start/stop time, days, simultaneous downloads; sleep or shut down when done'],
    grabber: ['Site grabber', 'Collects files of chosen types from a site; follows robots.txt rules'],
    batch: ['Batch download', 'Numbered files with a wildcard pattern: file*.zip, 1–50, 3 digits'],
    connection: ['Settings › Connection', 'Connections, retries, timeout, user agent and proxy'],
    browser: ['Settings › Browser integration', 'Chrome, Edge and Firefox extension: captures downloads, video button'],
    login: ['Single sign-on', 'Sign in once with your Mastertool account; the other apps won’t ask again'],
  },
};

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const lang of ['tr', 'en']) {
    const OUT = lang === 'tr' ? OUT_BASE : path.join(OUT_BASE, lang);
    fs.mkdirSync(OUT, { recursive: true });
    const T = TEXT[lang];
    const t = I18N.createT(lang);
    const manifest = [];
    const shot = async (file, theme, [title, caption], run) => {
      if (caption.length > 80) throw new Error(`caption > 80: ${caption}`);
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, locale: SAMPLE[lang].locale });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await run(page, theme === 'dark');
      await page.waitForTimeout(400); // animasyonlar otursun
      if (errs.length) throw new Error(`${file}: ${errs.join('; ')}`);
      await page.screenshot({ path: path.join(OUT, file) });
      await ctx.close();
      manifest.push({ file, theme, title, caption });
      console.log('✓', lang, file);
    };
    const openMain = async (page, after) => {
      await page.addInitScript(stubScript(lang));
      await page.goto('file://' + path.join(ROOT, 'src', 'renderer', 'index.html'));
      await page.waitForSelector('#tbody tr');
      await page.click('#tbody tr[data-id="d1"]');
      if (after) await after(page);
    };
    // Küçük pencereyi (giriş, ilerleme) masaüstü zemini üzerinde, başlık çubuğuyla gösterir
    const framed = async (p, dark, url, w, h, title, base) => {
      const lp = await p.context().newPage();
      await lp.setViewportSize({ width: w, height: h });
      await lp.addInitScript(stubScript(lang));
      await lp.goto(url);
      await lp.waitForTimeout(500);
      if (title === 'login') await lp.evaluate((pw) => { document.querySelector('#password').value = pw; document.activeElement.blur(); }, SAMPLE[lang].password);
      const png = (await lp.screenshot()).toString('base64');
      await lp.close();
      const icon = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'build', 'icon.png')).toString('base64')}`;
      const win = `<div style="position:absolute;${base ? 'right:90px;bottom:70px' : 'left:50%;top:50%;transform:translate(-50%,-50%)'};border-radius:10px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,${dark ? '.6' : '.28'}),0 0 0 1px rgba(${dark ? '255,255,255,.1' : '0,0,0,.1'})">
        <div style="height:32px;background:${dark ? '#1c1f26' : '#f3f3f3'};display:flex;align-items:center;gap:8px;padding:0 12px;font:12px 'Segoe UI',system-ui;color:${dark ? '#ddd' : '#333'}">
          <img src="${icon}" style="width:16px;height:16px;border-radius:4px">Master Download</div>
        <img src="data:image/png;base64,${png}" style="display:block;width:${w}px;height:${h}px"></div>`;
      if (base) {
        await p.evaluate((html) => document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.18)">${html}</div>`), win);
      } else {
        const bg = dark ? 'radial-gradient(900px 600px at 80% 0%, #1e2a4a, transparent), radial-gradient(800px 600px at 0% 100%, #0f3a44, transparent), #0b0f17'
          : 'radial-gradient(900px 600px at 80% 0%, #dbe4ff, transparent), radial-gradient(800px 600px at 0% 100%, #d5f5fb, transparent), #eef2f7';
        await p.setContent(`<body style="margin:0;height:100vh;position:relative;background:${bg}">${win}</body>`);
      }
    };

    for (const theme of ['dark', 'light']) {
      const tn = theme === 'dark' ? 'gece' : 'gunduz';
      await shot(`01-indirmeler-${tn}.png`, theme, T.list, (p) => openMain(p));
      await shot(`02-yeni-indirme-${tn}.png`, theme, T.add, (p) => openMain(p, async (pg) => {
        await pg.click('#tAdd');
        await pg.fill('#a-url', 'https://downloads.example.com/releases/sample-tools-3.1.zip');
        await pg.dispatchEvent('#a-url', 'input');
      }));
      await shot(`03-ilerleme-${tn}.png`, theme, T.progress, (p, dark) => openMain(p, (pg) =>
        framed(pg, dark, 'file://' + path.join(ROOT, 'src', 'renderer', 'progress.html') + '?id=d1', 620, 500, 'progress', true)));
      await shot(`04-kuyruklar-${tn}.png`, theme, T.queues, (p) => openMain(p, async (pg) => {
        await pg.click('#tScheduler');
        await pg.waitForSelector('#q-nav');
        await pg.click('#q-nav button[data-id="night"]');
      }));
      await shot(`05-site-yakalayici-${tn}.png`, theme, T.grabber, (p) => openMain(p, async (pg) => {
        await pg.click('#tGrabber');
        await pg.fill('#g-url', 'https://downloads.example.com/files/');
        await pg.fill('#g-exts', 'zip 7z pdf');
        await pg.click(`.modal footer .btn:has-text("${t('grab.scan')}")`);
        await pg.waitForSelector('#g-list .b-row');
      }));
      await shot(`06-toplu-indirme-${tn}.png`, theme, T.batch, (p) => openMain(p, async (pg) => {
        await pg.click('#tBatch');
        await pg.fill('#b-url', 'https://images.example.com/gallery/photo*.jpg');
        await pg.fill('#b-to', '50');
        await pg.fill('#b-width', '3');
        await pg.dispatchEvent('#b-width', 'input');
        await pg.waitForSelector('#b-list .b-row');
      }));
      await shot(`07-ayarlar-baglanti-${tn}.png`, theme, T.connection, (p) => openMain(p, async (pg) => {
        await pg.click('#btnSettings');
        await pg.click('.set-nav [data-tab="connection"]');
      }));
      await shot(`08-ayarlar-tarayici-${tn}.png`, theme, T.browser, (p) => openMain(p, async (pg) => {
        await pg.click('#btnSettings');
        await pg.click('.set-nav [data-tab="browser"]');
      }));
      await shot(`09-giris-${tn}.png`, theme, T.login, (p, dark) => framed(p, dark, 'file://' + path.join(ROOT, 'src', 'renderer', 'login.html'), 440, 640, 'login', false));
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${manifest.length} görüntü → ${path.relative(ROOT, OUT)}`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
