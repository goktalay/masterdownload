'use strict';

// Native messaging host kaydı (Windows): manifest JSON'ları, md-host.cmd sarmalayıcısı ve kayıt defteri komutları.
// Bu modül hiçbir şey ÇALIŞTIRMAZ; reg komutlarını argüman dizisi olarak döner, ana süreç
// child_process.execFile('reg', args) ile uygular. Böylece Linux'ta da test edilebilir.

const fs = require('fs');
const path = require('path');

const HOST_NAME = 'com.mastertool.masterdownload';
const FIREFOX_ID = 'masterdownload@mastertool.download';
const DESCRIPTION = 'Master Download — browser integration host';
const CMD_NAME = 'md-host.cmd';
const MANIFEST_FILES = {
  chromium: `${HOST_NAME}.chromium.json`,
  firefox: `${HOST_NAME}.firefox.json`,
};

// Chromium eklenti kimliği: 32 karakter a–p
const isChromiumId = (id) => /^[a-p]{32}$/.test(String(id || ''));

function hostManifest({ hostPath, browser = 'chromium', chromiumIds = [] } = {}) {
  if (!hostPath) throw new TypeError('hostPath gerekli');
  const m = { name: HOST_NAME, description: DESCRIPTION, path: hostPath, type: 'stdio' };
  if (browser === 'firefox') {
    m.allowed_extensions = [FIREFOX_ID];
  } else if (browser === 'chromium') {
    const ids = [...new Set((chromiumIds || []).filter(isChromiumId))];
    m.allowed_origins = ids.map((id) => `chrome-extension://${id}/`);
  } else {
    throw new TypeError(`bilinmeyen tarayıcı: ${browser}`);
  }
  return m;
}

function cmdContent({ exePath, appAsarPath }) {
  // Tarayıcı, host'a köken bilgisini argüman olarak verir (%*); nmhost.js bunları yoksayar.
  return ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${exePath}" "${appAsarPath}\\src\\nmhost.js" %*`, ''].join('\r\n');
}

// dir: ör. %LOCALAPPDATA%\Master Download\nmhost
function writeHostFiles({ dir, exePath, appAsarPath, chromiumIds = [] } = {}) {
  if (!dir || !exePath || !appAsarPath) throw new TypeError('dir, exePath ve appAsarPath gerekli');
  fs.mkdirSync(dir, { recursive: true });
  const cmdPath = path.join(dir, CMD_NAME);
  fs.writeFileSync(cmdPath, cmdContent({ exePath, appAsarPath }));
  const out = { cmdPath };
  for (const browser of ['chromium', 'firefox']) {
    const p = path.join(dir, MANIFEST_FILES[browser]);
    const m = hostManifest({ hostPath: cmdPath, browser, chromiumIds });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
    fs.renameSync(tmp, p);
    out[browser] = p;
  }
  return out;
}

const REG_KEYS = {
  chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
  firefox: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`,
};

// execFile('reg', args) için argüman dizileri: varsayılan değer (/ve) manifest dosyasının tam yolu
function registryCommands({ dir } = {}) {
  if (!dir) throw new TypeError('dir gerekli');
  const j = (f) => path.win32.join(dir, f);
  return [
    ['add', REG_KEYS.chrome, '/ve', '/t', 'REG_SZ', '/d', j(MANIFEST_FILES.chromium), '/f'],
    ['add', REG_KEYS.edge, '/ve', '/t', 'REG_SZ', '/d', j(MANIFEST_FILES.chromium), '/f'],
    ['add', REG_KEYS.firefox, '/ve', '/t', 'REG_SZ', '/d', j(MANIFEST_FILES.firefox), '/f'],
  ];
}

function unregisterCommands() {
  return Object.values(REG_KEYS).map((k) => ['delete', k, '/f']);
}

module.exports = {
  HOST_NAME, FIREFOX_ID, CMD_NAME, MANIFEST_FILES, REG_KEYS,
  hostManifest, cmdContent, writeHostFiles, registryCommands, unregisterCommands, isChromiumId,
};
