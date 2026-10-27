'use strict';

// Uygulama tarafı kanal sunucusu: tarayıcı eklentisinin native messaging host'u (src/nmhost.js) buraya bağlanır.
// Windows'ta adlandırılmış kanal (\\.\pipe\master-download-<kullanıcı>), diğer sistemlerde Unix soketi.
// Protokol: satır başına bir JSON nesnesi (UTF-8, '\n' ile biter); her isteğe tek satır yanıt.
// Bir istemcinin istekleri SIRAYLA işlenir (yanıtlar istek sırasıyla döner); istemciler birbirini beklemez.
// Electron'a bağımlı değildir; nmhost.js de pipePath() için bu dosyayı kullanır.

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LINE = 1024 * 1024; // 1 MB satır sınırı (native messaging host → tarayıcı sınırı ile aynı)

// Kanal/soket adında kullanılabilecek güvenli kullanıcı adı
function safeUserName() {
  let u = '';
  try { u = os.userInfo().username || ''; } catch { /* bazı ortamlarda userInfo hata verir */ }
  if (!u) u = process.env.USERNAME || process.env.USER || 'user';
  const s = String(u).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return s || 'user';
}

// nmhost ile ortak kanal adı. MD_PIPE ortam değişkeni varsa o kullanılır (testler, taşınabilir sürüm).
function pipePath(env = process.env, platform = process.platform) {
  if (env.MD_PIPE) return env.MD_PIPE;
  const name = `master-download-${safeUserName()}`;
  if (platform === 'win32') return `\\\\.\\pipe\\${name}`;
  return path.join(os.tmpdir(), `${name}.sock`);
}

const isWinPipe = (p) => /^\\\\[.?]\\pipe\\/i.test(p);

// Unix'te soket dosyası duruyorsa canlı bir sunucu mu, yoksa çökmüş süreçten kalan artık mı?
function probeAlive(p) {
  return new Promise((resolve) => {
    const s = net.connect(p);
    const done = (v) => { s.removeAllListeners(); s.destroy(); resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), 1000).unref();
  });
}

function createBridge({ pipePath: p = pipePath(), onMessage, log = () => {} } = {}) {
  if (typeof onMessage !== 'function') throw new TypeError('onMessage gerekli');
  const sockets = new Set();

  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.setEncoding('utf8');
    let buf = '';
    let chain = Promise.resolve();
    let dead = false;

    const send = (obj) => {
      if (dead || sock.destroyed) return;
      let line;
      try { line = JSON.stringify(obj === undefined ? { ok: true } : obj); } catch { line = JSON.stringify({ ok: false, code: 'internal' }); }
      if (Buffer.byteLength(line) > MAX_LINE) line = JSON.stringify({ ok: false, code: 'too_large' });
      sock.write(line + '\n');
    };

    const handle = async (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { msg = undefined; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { send({ ok: false, code: 'bad_request' }); return; }
      try {
        send(await onMessage(msg));
      } catch (e) {
        log('bridge onMessage hatası', e);
        send({ ok: false, code: (e && e.code && typeof e.code === 'string') ? e.code : 'internal' });
      }
    };

    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > MAX_LINE) { chain = chain.then(() => send({ ok: false, code: 'too_large' })); continue; }
        chain = chain.then(() => handle(line));
      }
      // Satır sonu gelmeden 1 MB aşıldıysa istemci kuralı çiğniyor: yanıtla ve bağlantıyı kapat
      if (Buffer.byteLength(buf) > MAX_LINE) {
        buf = '';
        chain = chain.then(() => { send({ ok: false, code: 'too_large' }); dead = true; sock.end(); });
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => { dead = true; sockets.delete(sock); });
  });

  async function listen() {
    if (!isWinPipe(p) && fs.existsSync(p)) {
      if (await probeAlive(p)) {
        const e = new Error(`kanal kullanımda: ${p}`);
        e.code = 'EADDRINUSE';
        throw e;
      }
      try { fs.unlinkSync(p); } catch { /* başkası silmiş olabilir */ }
    }
    await new Promise((resolve, reject) => {
      const onErr = (e) => reject(e);
      server.once('error', onErr);
      server.listen(p, () => { server.removeListener('error', onErr); resolve(); });
    });
    if (!isWinPipe(p)) { try { fs.chmodSync(p, 0o600); } catch { /* yoksay */ } }
    return p;
  }

  async function close() {
    for (const s of sockets) s.destroy();
    sockets.clear();
    await new Promise((resolve) => { if (!server.listening) resolve(); else server.close(() => resolve()); });
    if (!isWinPipe(p)) { try { fs.unlinkSync(p); } catch { /* yok */ } }
  }

  return { listen, close, path: p, server };
}

module.exports = { createBridge, pipePath, safeUserName, MAX_LINE };
