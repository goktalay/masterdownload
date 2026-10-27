'use strict';

// Eklenti derleme: tek kaynak (extension/src) → iki paketlenmemiş eklenti
//   dist/chromium/  Chrome/Edge (MV3, background.service_worker)
//   dist/firefox/   Firefox 115+ (MV3, background.scripts, browser_specific_settings.gecko.id)
// extension/key.pem (yoksa depodaki açık anahtar key.pub.pem) varsa açık anahtarı Chromium manifestine "key" olarak yazılır (sabit eklenti kimliği).
// Kullanım: node extension/build.js [--out <klasör>] [--key <pem>]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeIcons } = require('./make-icons');

const SRC = path.join(__dirname, 'src');
const FIREFOX_ID = 'masterdownload@mastertool.download';
const PERMISSIONS = ['downloads', 'contextMenus', 'cookies', 'nativeMessaging', 'storage', 'webRequest', 'notifications', 'scripting'];
// Chromium "zh" klasörünü tanımaz; derlemede zh_CN ve zh_TW olarak da kopyalanır
const LOCALE_ALIASES = { zh: ['zh_CN', 'zh_TW'] };

function version() {
  try { return require('../package.json').version || '0.1.0'; } catch { return '0.1.0'; }
}

// PEM (özel ya da açık anahtar) → manifest "key" (SPKI DER, base64)
function publicKeyB64(pem) {
  const pub = crypto.createPublicKey(pem);
  return pub.export({ type: 'spki', format: 'der' }).toString('base64');
}

// Chromium eklenti kimliği: SPKI DER'in SHA-256'sının ilk 16 baytı, her yarım bayt 'a'+değer
function extensionIdFromKey(b64) {
  const h = crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 32);
  return h.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

function baseManifest() {
  const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'Master Download',
    description: '__MSG_extDesc__',
    version: version(),
    default_locale: 'en',
    homepage_url: 'https://mastertool.download/',
    icons,
    action: { default_title: '__MSG_extName__', default_popup: 'popup.html', default_icon: { 16: icons[16], 32: icons[32], 48: icons[48] } },
    options_ui: { page: 'options.html', open_in_tab: true },
    permissions: PERMISSIONS.slice(),
    host_permissions: ['<all_urls>'],
    content_scripts: [{ matches: ['<all_urls>'], js: ['rules.js', 'content.js'], run_at: 'document_start', all_frames: true }],
  };
}

function chromiumManifest(keyB64) {
  const m = baseManifest();
  m.background = { service_worker: 'background.js' };
  m.minimum_chrome_version = '110';
  if (keyB64) m.key = keyB64;
  return m;
}

function firefoxManifest() {
  const m = baseManifest();
  m.background = { scripts: ['rules.js', 'background.js'] };
  m.browser_specific_settings = { gecko: { id: FIREFOX_ID, strict_min_version: '115.0' } };
  return m;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

function build({ out = path.join(__dirname, 'dist'), keyPath = fs.existsSync(path.join(__dirname, 'key.pem')) ? path.join(__dirname, 'key.pem') : path.join(__dirname, 'key.pub.pem'), log = () => {} } = {}) {
  // Simgeler kaynakta yoksa üret
  if (!fs.existsSync(path.join(SRC, 'icons', 'icon-128.png'))) writeIcons(path.join(SRC, 'icons'));

  let keyB64 = null;
  if (keyPath && fs.existsSync(keyPath)) keyB64 = publicKeyB64(fs.readFileSync(keyPath, 'utf8'));

  const targets = { chromium: chromiumManifest(keyB64), firefox: firefoxManifest() };
  const result = { out, chromiumId: keyB64 ? extensionIdFromKey(keyB64) : null, manifests: {} };
  for (const [name, manifest] of Object.entries(targets)) {
    const dir = path.join(out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    copyDir(SRC, dir);
    for (const [src, aliases] of Object.entries(LOCALE_ALIASES)) {
      for (const a of aliases) copyDir(path.join(dir, '_locales', src), path.join(dir, '_locales', a));
      fs.rmSync(path.join(dir, '_locales', src), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    result.manifests[name] = manifest;
    log(`${name}: ${dir}`);
  }
  if (result.chromiumId) log(`Chromium eklenti kimliği: ${result.chromiumId}`);
  else log('key.pem yok: Chromium eklenti kimliği yükleme klasörüne göre değişir (extension/README.md)');
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') opt.out = path.resolve(args[++i]);
    else if (args[i] === '--key') opt.keyPath = path.resolve(args[++i]);
  }
  build({ ...opt, log: (s) => console.log(s) });
}

module.exports = { build, chromiumManifest, firefoxManifest, publicKeyB64, extensionIdFromKey, PERMISSIONS, FIREFOX_ID };
