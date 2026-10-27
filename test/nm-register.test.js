'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const reg = require('../src/nm-register');
const { tmpDir } = require('./helpers');

const ID1 = 'abcdefghijklmnopabcdefghijklmnop';
const ID2 = 'ponmlkjihgfedcbaponmlkjihgfedcba';

test('hostManifest: Chromium allowed_origins, Firefox allowed_extensions', () => {
  const c = reg.hostManifest({ hostPath: 'C:\\x\\md-host.cmd', browser: 'chromium', chromiumIds: [ID1, ID2, ID1, 'geçersiz'] });
  assert.deepStrictEqual(c, {
    name: 'com.mastertool.masterdownload',
    description: c.description,
    path: 'C:\\x\\md-host.cmd',
    type: 'stdio',
    allowed_origins: [`chrome-extension://${ID1}/`, `chrome-extension://${ID2}/`],
  });
  assert.ok(c.description);
  const f = reg.hostManifest({ hostPath: 'C:\\x\\md-host.cmd', browser: 'firefox' });
  assert.deepStrictEqual(f.allowed_extensions, ['masterdownload@mastertool.download']);
  assert.strictEqual(f.allowed_origins, undefined);
  assert.strictEqual(f.type, 'stdio');
  assert.throws(() => reg.hostManifest({ hostPath: 'x', browser: 'opera' }));
  assert.throws(() => reg.hostManifest({ browser: 'firefox' }));
});

test('writeHostFiles: md-host.cmd ve iki manifest', () => {
  const dir = path.join(tmpDir(), 'nmhost');
  const exe = 'C:\\Program Files\\Mastertool\\Master Download\\Master Download.exe';
  const asar = 'C:\\Program Files\\Mastertool\\Master Download\\resources\\app.asar';
  const out = reg.writeHostFiles({ dir, exePath: exe, appAsarPath: asar, chromiumIds: [ID1] });
  assert.strictEqual(out.cmdPath, path.join(dir, 'md-host.cmd'));
  const cmd = fs.readFileSync(out.cmdPath, 'utf8');
  assert.strictEqual(cmd, [
    '@echo off',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${exe}" "${asar}\\src\\nmhost.js" %*`,
    '',
  ].join('\r\n'));
  const c = JSON.parse(fs.readFileSync(out.chromium, 'utf8'));
  const f = JSON.parse(fs.readFileSync(out.firefox, 'utf8'));
  assert.strictEqual(path.basename(out.chromium), 'com.mastertool.masterdownload.chromium.json');
  assert.strictEqual(path.basename(out.firefox), 'com.mastertool.masterdownload.firefox.json');
  assert.strictEqual(c.path, out.cmdPath);
  assert.strictEqual(f.path, out.cmdPath);
  assert.deepStrictEqual(c.allowed_origins, [`chrome-extension://${ID1}/`]);
  assert.deepStrictEqual(f.allowed_extensions, ['masterdownload@mastertool.download']);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['com.mastertool.masterdownload.chromium.json', 'com.mastertool.masterdownload.firefox.json', 'md-host.cmd']);
  // İkinci yazım (güncelleme) sorunsuz
  reg.writeHostFiles({ dir, exePath: exe, appAsarPath: asar, chromiumIds: [ID2] });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out.chromium, 'utf8')).allowed_origins, [`chrome-extension://${ID2}/`]);
});

test('registryCommands / unregisterCommands: reg add/delete argümanları', () => {
  const dir = 'C:\\Users\\u\\AppData\\Local\\Master Download\\nmhost';
  const cmds = reg.registryCommands({ dir });
  assert.deepStrictEqual(cmds, [
    ['add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.mastertool.masterdownload', '/ve', '/t', 'REG_SZ', '/d', `${dir}\\com.mastertool.masterdownload.chromium.json`, '/f'],
    ['add', 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.mastertool.masterdownload', '/ve', '/t', 'REG_SZ', '/d', `${dir}\\com.mastertool.masterdownload.chromium.json`, '/f'],
    ['add', 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.mastertool.masterdownload', '/ve', '/t', 'REG_SZ', '/d', `${dir}\\com.mastertool.masterdownload.firefox.json`, '/f'],
  ]);
  assert.deepStrictEqual(reg.unregisterCommands(), [
    ['delete', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.mastertool.masterdownload', '/f'],
    ['delete', 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.mastertool.masterdownload', '/f'],
    ['delete', 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.mastertool.masterdownload', '/f'],
  ]);
  assert.throws(() => reg.registryCommands({}));
});
