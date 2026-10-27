'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createBridge, pipePath } = require('../src/bridge');
const { tmpDir, waitFor } = require('./helpers');

const NMHOST = path.join(__dirname, '..', 'src', 'nmhost.js');
const FAKE_APP = path.join(__dirname, 'fixtures', 'fake-app.js');

// Her test için benzersiz kanal adı (paralel çalışmalar çakışmasın)
function uniquePipe() {
  const id = `md-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), `${id}.sock`);
}

function frame(obj) {
  const body = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// nmhost'u gerçek süreç olarak çalıştırır; stdout çerçevelerini sıraya alır
function startHost(env) {
  const child = spawn(process.execPath, [NMHOST], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0);
  const frames = [];
  const waiters = [];
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const obj = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
      buf = buf.subarray(4 + len);
      if (waiters.length) waiters.shift()(obj); else frames.push(obj);
    }
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    child, exited,
    stderr: () => stderr,
    write: (b) => child.stdin.write(b),
    next: (ms = 10000) => new Promise((resolve, reject) => {
      if (frames.length) { resolve(frames.shift()); return; }
      const timer = setTimeout(() => reject(new Error(`yanıt gelmedi; stderr: ${stderr}`)), ms);
      waiters.push((v) => { clearTimeout(timer); resolve(v); });
    }),
    kill: () => { try { child.kill(); } catch { /* yok */ } },
  };
}

async function withBridge(onMessage, fn) {
  const p = uniquePipe();
  const bridge = createBridge({ pipePath: p, onMessage });
  await bridge.listen();
  try { await fn(p, bridge); } finally { await bridge.close(); }
}

test('pipePath: MD_PIPE önceliklidir; Windows adlandırılmış kanal, diğerlerinde soket', () => {
  assert.strictEqual(pipePath({ MD_PIPE: 'x' }), 'x');
  assert.match(pipePath({}, 'win32'), /^\\\\\.\\pipe\\master-download-[A-Za-z0-9._-]+$/);
  assert.match(pipePath({}, 'linux'), /master-download-[A-Za-z0-9._-]+\.sock$/);
});

test('uçtan uca: ping ve add köprüye ulaşır, yanıt geri döner', async () => {
  const got = [];
  await withBridge(async (msg) => {
    got.push(msg);
    if (msg.type === 'ping') return { ok: true, pong: true };
    if (msg.type === 'add') return { ok: true, id: 'd42' };
    return { ok: false, code: 'unknown_type' };
  }, async (p) => {
    const h = startHost({ MD_PIPE: p });
    try {
      h.write(frame({ v: 1, type: 'ping' }));
      assert.deepStrictEqual(await h.next(), { ok: true, pong: true });
      const add = {
        v: 1, type: 'add', url: 'https://example.com/a.zip', referrer: 'https://example.com/', cookies: 'a=b; c=d',
        ua: 'UA/1.0', filename: 'a.zip', size: 123, mime: 'application/zip', kind: 'file', pageUrl: 'https://example.com/', title: 'Örnek ğüşiöç',
      };
      h.write(frame(add));
      assert.deepStrictEqual(await h.next(), { ok: true, id: 'd42' });
      assert.deepStrictEqual(got[1], add);
      h.write(frame({ v: 1, type: 'nope' }));
      assert.deepStrictEqual(await h.next(), { ok: false, code: 'unknown_type' });
      h.child.stdin.end();
      assert.strictEqual(await h.exited, 0);
    } finally { h.kill(); }
  });
});

test('çerçeveleme: iki mesaj tek parçada, parçalı başlık, büyük mesaj, 1 MB sınırı', async () => {
  const got = [];
  await withBridge(async (msg) => { got.push(msg); return { ok: true, n: got.length, len: (msg.url || '').length }; }, async (p) => {
    const h = startHost({ MD_PIPE: p });
    try {
      // İki mesaj tek yazımda
      h.write(Buffer.concat([frame({ v: 1, type: 'ping' }), frame({ v: 1, type: 'add', url: 'https://e.com/x' })]));
      assert.strictEqual((await h.next()).n, 1);
      assert.strictEqual((await h.next()).n, 2);

      // Başlık ve gövde bayt bayt bölünmüş
      const f = frame({ v: 1, type: 'add', url: 'https://e.com/parçalı' });
      for (const part of [f.subarray(0, 1), f.subarray(1, 3), f.subarray(3, 9), f.subarray(9)]) {
        h.write(part);
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.strictEqual((await h.next()).n, 3);

      // ~900 KB'lık mesaj (sınırın altında)
      const bigUrl = `https://e.com/${'a'.repeat(900 * 1024)}`;
      h.write(frame({ v: 1, type: 'add', url: bigUrl }));
      const r = await h.next();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.len, bigUrl.length);
      assert.strictEqual(got[3].url, bigUrl);

      // 1 MB'ı aşan mesaj reddedilir, akış bozulmaz
      h.write(frame({ v: 1, type: 'add', url: `https://e.com/${'b'.repeat(1024 * 1024)}` }));
      assert.deepStrictEqual(await h.next(), { ok: false, code: 'too_large' });
      h.write(frame('{bozuk json'));
      assert.deepStrictEqual(await h.next(), { ok: false, code: 'bad_request' });
      h.write(frame({ v: 1, type: 'ping' }));
      assert.strictEqual((await h.next()).n, 5);
      assert.strictEqual(got.length, 5);
    } finally { h.kill(); }
  });
});

test('köprü: geçersiz JSON bad_request; istemci başına sıralı yanıt; onMessage hatası', async () => {
  await withBridge(async (msg) => {
    if (msg.throw) throw new Error('patladı');
    await new Promise((r) => setTimeout(r, msg.delay || 0));
    return { ok: true, i: msg.i };
  }, async (p) => {
    const sock = net.connect(p);
    await new Promise((r) => sock.once('connect', r));
    sock.setEncoding('utf8');
    const lines = [];
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    });
    sock.write('{"i":1,"delay":80}\n{bu json değil\n[1,2]\n{"i":2}\n{"throw":true}\n');
    await waitFor(() => lines.length >= 5);
    assert.deepStrictEqual(lines, [
      { ok: true, i: 1 }, { ok: false, code: 'bad_request' }, { ok: false, code: 'bad_request' }, { ok: true, i: 2 }, { ok: false, code: 'internal' },
    ]);
    sock.destroy();
  });
});

test('köprü: aynı kanalda ikinci sunucu açılamaz; Unix\'te artık soket dosyası temizlenir', async () => {
  const p = uniquePipe();
  const a = createBridge({ pipePath: p, onMessage: async () => ({ ok: true }) });
  await a.listen();
  const b = createBridge({ pipePath: p, onMessage: async () => ({ ok: true }) });
  await assert.rejects(b.listen(), (e) => e.code === 'EADDRINUSE');
  await a.close();
  if (process.platform !== 'win32') {
    fs.writeFileSync(p, ''); // çökmüş süreçten kalan artık
    const c = createBridge({ pipePath: p, onMessage: async () => ({ ok: true }) });
    await c.listen();
    await c.close();
  }
});

test('uygulama kapalıyken host uygulamayı başlatır (ELECTRON_RUN_AS_NODE silinerek) ve bağlanır', async () => {
  const p = uniquePipe();
  const pidFile = path.join(tmpDir(), 'fake.pid');
  const h = startHost({
    MD_PIPE: p,
    MD_APP_EXE: process.execPath,
    MD_APP_ARGS: JSON.stringify([FAKE_APP, '--hidden']),
    MD_FIXTURE_PIDFILE: pidFile,
    ELECTRON_RUN_AS_NODE: '1',
  });
  try {
    h.write(frame({ v: 1, type: 'add', url: 'https://example.com/b.iso' }));
    const r = await h.next(20000);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.id, 'fake-1');
    assert.deepStrictEqual(r.args, ['--hidden']);
    assert.strictEqual(r.electronRunAsNode, null);
    // Aynı süreçte ikinci mesaj aynı bağlantıdan gider
    h.write(frame({ v: 1, type: 'ping' }));
    assert.strictEqual((await h.next()).type, 'ping');
    h.child.stdin.end();
    assert.strictEqual(await h.exited, 0);
  } finally {
    h.kill();
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch { /* kapanmış */ }
  }
});

test('uygulama başlatılamazsa app_unavailable', async () => {
  const h = startHost({
    MD_PIPE: uniquePipe(),
    MD_APP_EXE: path.join(tmpDir(), 'yok', 'Master Download.exe'),
    MD_CONNECT_TIMEOUT_MS: '900',
  });
  try {
    h.write(frame({ v: 1, type: 'ping' }));
    assert.deepStrictEqual(await h.next(), { ok: false, code: 'app_unavailable' });
    h.child.stdin.end();
    assert.strictEqual(await h.exited, 0);
  } finally { h.kill(); }
});
