// Uçtan uca: Electron uygulamasını gerçek ana süreçle çalıştırır. Sahte hesap sunucusu (test/mock-server.js) girişi,
// yerel dosya sunucusu (test/server.js) indirmeleri karşılar. Giriş penceresine CDP ile e-posta/şifre yazılır, ana
// pencerede "Adres ekle" ile çok parçalı bir indirme başlatılır, ilerleme penceresi ve tamamlanma denetlenir, dosyanın
// içeriği kaynakla karşılaştırılır, sayfa hataları yakalanır, ekran görüntüsü alınır.
// Kullanım: DISPLAY=:95 node scripts/e2e-electron.js [çıktı klasörü]
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const { createMock } = require('../test/mock-server');
const { startServer } = require('../test/server');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'md-e2e-shots'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mock = createMock();
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${mock.server.address().port}`;
  const files = await startServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'md-e2e-'));
  const dl = path.join(ud, 'Downloads');
  // İlk açılış ayarları: indirme klasörü geçici klasörde, tema gece
  fs.writeFileSync(path.join(ud, 'store.json'), JSON.stringify({ settings: { appTheme: 'dark', language: 'tr', downloads: { dir: dl } } }));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(path.join(ROOT, 'node_modules', '.bin', 'electron'), [ROOT, `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, '--no-sandbox'], {
    env: { ...process.env, MD_API: api, MD_PIPE: path.join(ud, 'md.sock') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const errors = [];
  const done = (code, msg) => {
    if (msg) console.error(code ? '×' : '✓', msg);
    if (code) console.error(log.split('\n').filter((l) => !/bus\.cc|viz_main|gles2|GroupMarker|dbus|Fontconfig/.test(l)).slice(-30).join('\n'));
    proc.kill();
    mock.server.close();
    files.close();
    process.exit(code);
  };
  const timer = setTimeout(() => done(1, 'zaman aşımı'), 90000);

  let browser = null;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* henüz yok */ }
  }
  if (!browser) return done(1, 'CDP bağlanamadı');
  const ctx = browser.contexts()[0];
  const pageFor = async (re) => {
    for (let i = 0; i < 60; i++) {
      const p = ctx.pages().find((x) => re.test(x.url()));
      if (p) { p.on('pageerror', (e) => errors.push(`${re}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') errors.push(`${re}: ${m.text()}`); }); return p; }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`pencere yok: ${re}`);
  };

  try {
    const login = await pageFor(/login\.html/);
    await login.waitForSelector('#email');
    await login.screenshot({ path: path.join(OUT, 'giris.png') });
    await login.fill('#email', 'test@example.com');
    await login.fill('#password', 'Test1234!');
    await login.click('#submit');

    const main = await pageFor(/index\.html/);
    await main.waitForSelector('#tAdd');
    await main.waitForTimeout(400);
    await main.screenshot({ path: path.join(OUT, 'bos-liste.png') });

    // Adres ekle → Şimdi başlat (8 bağlantı, 6 MB, yavaş sunucu: ilerleme penceresi görünsün)
    const size = 6 * 1024 * 1024;
    const url = `${files.base}/slow/ornek-arsiv.zip?size=${size}&bps=900000`;
    await main.click('#tAdd');
    await main.fill('#a-url', url);
    await main.click('.modal footer .btn.primary');
    const pw = await pageFor(/progress\.html/);
    await pw.waitForFunction(() => /%/.test(document.querySelector('#pct').textContent || '') && document.querySelectorAll('#map .seg').length > 1, null, { timeout: 15000 });
    await pw.waitForTimeout(900);
    await pw.screenshot({ path: path.join(OUT, 'ilerleme.png') });
    await main.waitForTimeout(300);
    await main.click('#tbody tr');
    await main.waitForTimeout(500);
    await main.screenshot({ path: path.join(OUT, 'indiriliyor.png') });

    await main.waitForFunction(() => document.querySelector('#tbody tr.s-completed'), null, { timeout: 30000 });
    const file = path.join(dl, 'Sıkıştırılmış', 'ornek-arsiv.zip');
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    if (!fs.existsSync(file)) throw new Error(`dosya yok: ${file}`);
    if (sha(fs.readFileSync(file)) !== sha(files.body(size))) throw new Error('içerik farklı');
    const ranges = files.stats.ranges.length;
    if (ranges < 8) throw new Error(`çok parçalı değil (${ranges} aralık)`);
    await main.waitForTimeout(400);
    await main.screenshot({ path: path.join(OUT, 'tamamlandi.png') });

    // Ayarlar penceresi açılıyor mu (tüm sekmeler)
    await main.click('#btnSettings');
    for (const tab of ['general', 'connection', 'downloads', 'categories', 'browser', 'limit', 'queues', 'about']) {
      await main.click(`.set-nav button[data-tab="${tab}"]`);
      await main.waitForTimeout(80);
    }
    await main.screenshot({ path: path.join(OUT, 'ayarlar.png') });
    await main.keyboard.press('Escape');

    if (errors.length) throw new Error(`sayfa hataları:\n${errors.join('\n')}`);
    clearTimeout(timer);
    done(0, `giriş, 8 bağlantılı indirme (${ranges} aralık isteği), birleştirme, ilerleme penceresi, ayarlar — ekran görüntüleri ${OUT}`);
  } catch (e) {
    clearTimeout(timer);
    if (errors.length) console.error(errors.join('\n'));
    done(1, e.message);
  }
})();
