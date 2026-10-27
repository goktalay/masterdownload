'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tmpDir } = require('./helpers');

const EXT = path.join(__dirname, '..', 'extension');
const R = require('../extension/src/rules.js');
const { build, extensionIdFromKey } = require('../extension/build.js');
const LANGS = ['tr', 'en', 'fr', 'de', 'es', 'ar', 'zh', 'ru'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('_locales: 8 dil, eşit anahtarlar, boş ileti yok, kodda kullanılan anahtarlar tanımlı', () => {
  const dir = path.join(EXT, 'src', '_locales');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), LANGS.slice().sort());
  const base = readJson(path.join(dir, 'en', 'messages.json'));
  const keys = Object.keys(base).sort();
  for (const l of LANGS) {
    const m = readJson(path.join(dir, l, 'messages.json'));
    assert.deepStrictEqual(Object.keys(m).sort(), keys, `${l} anahtarları farklı`);
    for (const k of keys) {
      assert.ok(m[k].message && m[k].message.trim(), `${l}.${k} boş`);
      assert.deepStrictEqual(Object.keys(m[k].placeholders || {}), Object.keys(base[k].placeholders || {}), `${l}.${k} yer tutucu`);
    }
  }
  // Kaynakta geçen tüm i18n anahtarları en'de olmalı
  const used = new Set();
  for (const f of ['background.js', 'content.js', 'popup.js', 'options.js', 'popup.html', 'options.html']) {
    const s = fs.readFileSync(path.join(EXT, 'src', f), 'utf8');
    for (const m of s.matchAll(/\bt\('([A-Za-z]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n="([A-Za-z]+)"/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(base[k], `tanımsız anahtar: ${k}`);
  assert.ok(used.size > 20);
});

test('build.js: Chromium ve Firefox manifestleri, dosyalar, key.pem ile sabit kimlik', () => {
  const out = tmpDir();
  const noKey = build({ out, keyPath: path.join(out, 'yok.pem') });
  assert.strictEqual(noKey.chromiumId, null);
  const c = readJson(path.join(out, 'chromium', 'manifest.json'));
  const f = readJson(path.join(out, 'firefox', 'manifest.json'));
  for (const m of [c, f]) {
    assert.strictEqual(m.manifest_version, 3);
    assert.strictEqual(m.name, '__MSG_extName__');
    assert.strictEqual(m.default_locale, 'en');
    assert.deepStrictEqual(m.host_permissions, ['<all_urls>']);
    for (const p of ['downloads', 'contextMenus', 'cookies', 'nativeMessaging', 'storage', 'webRequest', 'notifications', 'scripting']) {
      assert.ok(m.permissions.includes(p), p);
    }
    assert.deepStrictEqual(m.content_scripts[0].js, ['rules.js', 'content.js']);
  }
  assert.deepStrictEqual(c.background, { service_worker: 'background.js' });
  assert.strictEqual(c.key, undefined);
  assert.strictEqual(c.browser_specific_settings, undefined);
  assert.deepStrictEqual(f.background, { scripts: ['rules.js', 'background.js'] });
  assert.strictEqual(f.browser_specific_settings.gecko.id, 'masterdownload@mastertool.download');
  assert.strictEqual(f.browser_specific_settings.gecko.strict_min_version, '115.0');
  for (const t of ['chromium', 'firefox']) {
    for (const file of ['background.js', 'content.js', 'rules.js', 'popup.html', 'popup.js', 'options.html', 'options.js',
      'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png', '_locales/en/messages.json', '_locales/zh_CN/messages.json']) {
      assert.ok(fs.existsSync(path.join(out, t, file)), `${t}/${file}`);
    }
  }

  // key.pem → manifest "key" + bilinen kimlik
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = path.join(out, 'key.pem');
  fs.writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const withKey = build({ out, keyPath: pem });
  const c2 = readJson(path.join(out, 'chromium', 'manifest.json'));
  const der = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  assert.strictEqual(c2.key, der.toString('base64'));
  assert.match(withKey.chromiumId, /^[a-p]{32}$/);
  assert.strictEqual(withKey.chromiumId, extensionIdFromKey(c2.key));
  assert.strictEqual(readJson(path.join(out, 'firefox', 'manifest.json')).key, undefined);
});

test('simgeler: geçerli PNG, doğru boyut', () => {
  const { renderIcon } = require('../extension/make-icons.js');
  for (const s of [16, 32, 48, 128]) {
    const png = renderIcon(s);
    assert.strictEqual(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.strictEqual(png.readUInt32BE(16), s);
    assert.strictEqual(png.readUInt32BE(20), s);
  }
});

test('extensionIdFromKey: bilinen örnek', () => {
  // SHA-256("") = e3b0c442…; ilk 32 onaltılık hane a–p'ye çevrilir
  assert.strictEqual(extensionIdFromKey(''), 'odlameecjipmbmbejkplpemijjgpljce');
});

test('rules.shouldCapture: uzantı, boyut, istisna site, Alt/Ctrl, protokol', () => {
  const s = R.normalizeSettings({ exts: 'zip exe .MP4', minSizeKB: 100, skipSites: ['*.skip.com', 'only.org'] });
  assert.strictEqual(R.shouldCapture('https://a.com/f.zip', 500 * 1024, s, false, false), true);
  assert.strictEqual(R.shouldCapture('https://a.com/F.ZIP?x=1#y', 0, s, false, false), true); // boyut bilinmiyor
  assert.strictEqual(R.shouldCapture('https://a.com/f.zip', -1, s, false, false), true);
  assert.strictEqual(R.shouldCapture('https://a.com/f.zip', 50 * 1024, s, false, false), false); // küçük
  assert.strictEqual(R.shouldCapture('https://a.com/f.pdf', 500 * 1024, s, false, false), false); // listede yok
  assert.strictEqual(R.shouldCapture('https://a.com/video.mp4', 500 * 1024, s, false, false), true);
  assert.strictEqual(R.shouldCapture('https://a.com/download?id=5', 500 * 1024, s, false, false, 'C:\\Users\\u\\Downloads\\setup.exe'), true);
  assert.strictEqual(R.shouldCapture('ftp://a.com/f.zip', 0, s, false, false), true);
  assert.strictEqual(R.shouldCapture('blob:https://a.com/1234', 0, s, false, true), false);
  assert.strictEqual(R.shouldCapture('data:application/zip;base64,AAAA', 0, s, false, true), false);
  assert.strictEqual(R.shouldCapture('file:///c:/f.zip', 0, s, false, false), false);
  assert.strictEqual(R.shouldCapture('https://cdn.skip.com/f.zip', 0, s, false, false), false);
  assert.strictEqual(R.shouldCapture('https://skip.com/f.zip', 0, s, false, false), false);
  assert.strictEqual(R.shouldCapture('https://x.only.org/f.zip', 0, s, false, false), false);
  assert.strictEqual(R.shouldCapture('https://notonly.org/f.zip', 0, s, false, false), true);
  // Alt: her zaman tarayıcıda kalır (Ctrl ile birlikte bile)
  assert.strictEqual(R.shouldCapture('https://a.com/f.zip', 0, s, true, false), false);
  assert.strictEqual(R.shouldCapture('https://a.com/f.zip', 0, s, true, true), false);
  // Ctrl: uzantı/boyut/kapalı yakalama fark etmeksizin zorla
  assert.strictEqual(R.shouldCapture('https://a.com/page', 10, s, false, true), true);
  assert.strictEqual(R.shouldCapture('https://a.com/f.pdf', 10, { ...s, enabled: false }, false, true), true);
  assert.strictEqual(R.shouldCapture('https://cdn.skip.com/f.zip', 0, s, false, true), false);
  // Yakalama kapalı
  assert.strictEqual(R.shouldCapture('https://a.com/f.zip', 0, { ...s, enabled: false }, false, false), false);
  // Varsayılan ayarlar
  assert.strictEqual(R.shouldCapture('https://a.com/setup.exe', 0, undefined, false, false), true);
  assert.strictEqual(R.shouldCapture('https://a.com/index.html', 0, undefined, false, false), false);
  assert.strictEqual(R.shouldCapture('geçersiz adres', 0, undefined, false, false), false);
});

test('rules.isBlockedSite: bilinen platformlar ve alt alan adları', () => {
  for (const h of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.netflix.com', 'disneyplus.com', 'www.primevideo.com',
    'hulu.com', 'play.max.com', 'open.spotify.com', 'music.apple.com', 'tv.apple.com', 'www.twitch.tv', 'rr1---sn-x.googlevideo.com', 'WWW.YOUTUBE.COM']) {
    assert.strictEqual(R.isBlockedSite(h), true, h);
  }
  for (const h of ['example.com', 'apple.com', 'www.apple.com', 'notyoutube.com', 'youtube.com.evil.net', 'maxcdn.com', 'vimeo-like.org', '']) {
    assert.strictEqual(R.isBlockedSite(h), false, h);
  }
  assert.strictEqual(R.isBlockedSite('https://www.youtube.com/watch?v=x'), true);
});

test('rules.detectKind: HLS, DASH, dosya, parça ve medya olmayanlar', () => {
  assert.strictEqual(R.detectKind('https://a.com/master.m3u8?token=1', ''), 'hls');
  assert.strictEqual(R.detectKind('https://a.com/play', 'application/vnd.apple.mpegurl'), 'hls');
  assert.strictEqual(R.detectKind('https://a.com/play', 'application/x-mpegURL; charset=utf-8'), 'hls');
  assert.strictEqual(R.detectKind('https://a.com/manifest.mpd', ''), 'dash');
  assert.strictEqual(R.detectKind('https://a.com/m', 'application/dash+xml'), 'dash');
  assert.strictEqual(R.detectKind('https://a.com/v.mp4', 'video/mp4'), 'file');
  assert.strictEqual(R.detectKind('https://a.com/stream', 'audio/mpeg'), 'file');
  assert.strictEqual(R.detectKind('https://a.com/v.webm', ''), 'file');
  assert.strictEqual(R.detectKind('https://a.com/v.mp4', 'application/octet-stream'), 'file');
  assert.strictEqual(R.detectKind('https://a.com/seg-001.ts', 'video/mp2t'), null);
  assert.strictEqual(R.detectKind('https://a.com/chunk-1.m4s', 'video/mp4'), null);
  assert.strictEqual(R.detectKind('https://a.com/page.html', 'text/html'), null);
  assert.strictEqual(R.detectKind('https://a.com/app.js', 'application/javascript'), null);
  assert.strictEqual(R.detectKind('https://a.com/img.png', 'image/png'), null);
  assert.strictEqual(R.isMediaWorthy('file', 100 * 1024), false);
  assert.strictEqual(R.isMediaWorthy('file', 512 * 1024), true);
  assert.strictEqual(R.isMediaWorthy('file', 0), true);
  assert.strictEqual(R.isMediaWorthy('hls', 2000), true);
  assert.strictEqual(R.isMediaWorthy(null, 0), false);
});

test('rules yardımcıları: extOf, fileNameOf, matchSite, cookieHeader, normalizeSettings', () => {
  assert.strictEqual(R.extOf('https://a.com/d/%C3%B6rnek.TAR.GZ?x=1'), 'gz');
  assert.strictEqual(R.extOf('https://a.com/dir/'), '');
  assert.strictEqual(R.extOf('C:\\a\\b.zip'), 'zip');
  assert.strictEqual(R.extOf('.bashrc'), '');
  assert.strictEqual(R.fileNameOf('https://a.com/d/%C3%B6rnek.zip?x'), 'örnek.zip');
  assert.strictEqual(R.matchSite('a.b.example.com', '*.example.com'), true);
  assert.strictEqual(R.matchSite('example.com', '*.example.com'), true);
  assert.strictEqual(R.matchSite('cdn1.files.net', '*cdn*'), true);
  assert.strictEqual(R.matchSite('example.com', 'https://example.com/path'), true);
  assert.strictEqual(R.matchSite('badexample.com', 'example.com'), false);
  assert.strictEqual(R.cookieHeader([{ name: 'a', value: 'b' }, { name: 'c', value: 'd' }]), 'a=b; c=d');
  const d = R.normalizeSettings({});
  assert.deepStrictEqual(d.exts, R.DEFAULT_EXTS);
  assert.strictEqual(d.enabled, true);
  assert.strictEqual(d.videoButton, true);
  const n = R.normalizeSettings({ exts: '*.ZIP, .rar;rar  b@d', minSizeKB: '-5', skipSites: 'a.com\n\n b.com ' });
  assert.deepStrictEqual(n.exts, ['zip', 'rar']);
  assert.strictEqual(n.minSizeKB, 0);
  assert.deepStrictEqual(n.skipSites, ['a.com', 'b.com']);
});
