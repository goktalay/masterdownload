'use strict';

// Native messaging host: com.mastertool.masterdownload
// Tarayıcı bu süreci md-host.cmd üzerinden başlatır; .cmd, ELECTRON_RUN_AS_NODE=1 ile
// "Master Download.exe" içindeki bu dosyayı düz Node olarak çalıştırır (pencere yok, tek örnek kilidi yok).
//
// Tarayıcı → host: stdin'den çerçeveler (4 bayt little-endian uzunluk + UTF-8 JSON).
// Host → tarayıcı: stdout'a aynı çerçeve. Her iki yönde 1 MB sınırı uygulanır.
// Her mesaj uygulamanın kanalına (src/bridge.js) satır başına JSON olarak iletilir, gelen yanıt aynen geri döner.
// Kanal yoksa uygulama gizli başlatılır ve kanal açılana kadar beklenir (en çok 15 sn).
// stdout yalnız protokole aittir: tanılama iletileri stderr'e yazılır (tarayıcı onu günlüğe alır).

const net = require('net');
const { spawn } = require('child_process');
const { pipePath } = require('./bridge');

const MAX_MSG = 1024 * 1024;
const CONNECT_TIMEOUT = Number(process.env.MD_CONNECT_TIMEOUT_MS) || 15000;
const RETRY_MS = 300;
const REPLY_TIMEOUT = Number(process.env.MD_REPLY_TIMEOUT_MS) || 60000;

const log = (...a) => { try { process.stderr.write(`[md-host] ${a.join(' ')}\n`); } catch { /* yoksay */ } };

// ---- stdout çerçeveleme ----
function writeFrame(obj) {
  let body = Buffer.from(JSON.stringify(obj), 'utf8');
  if (body.length > MAX_MSG) body = Buffer.from(JSON.stringify({ ok: false, code: 'too_large' }), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([head, body]), () => resolve()));
}

// ---- uygulama kanalı ----
const PIPE = pipePath();
let conn = null; // { sock, waiters: [resolve...], buf }

function tryConnect() {
  return new Promise((resolve) => {
    const sock = net.connect(PIPE);
    sock.once('connect', () => { sock.removeAllListeners('error'); resolve(sock); });
    sock.once('error', () => { sock.destroy(); resolve(null); });
  });
}

function launchApp() {
  const exe = process.env.MD_APP_EXE || process.execPath;
  let args = ['--hidden'];
  if (process.env.MD_APP_ARGS) {
    try {
      const a = JSON.parse(process.env.MD_APP_ARGS);
      if (Array.isArray(a)) args = a.map(String);
    } catch { log('MD_APP_ARGS geçersiz JSON, varsayılan kullanılıyor'); }
  }
  // Uygulama tam Electron olarak açılmalı: ELECTRON_RUN_AS_NODE ortamdan SİLİNİR
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', env, windowsHide: false });
    child.on('error', (e) => log('uygulama başlatılamadı:', e.message));
    child.unref();
  } catch (e) {
    log('uygulama başlatılamadı:', e.message);
  }
}

function attach(sock) {
  const c = { sock, waiters: [], buf: '' };
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    c.buf += chunk;
    let i;
    while ((i = c.buf.indexOf('\n')) >= 0) {
      const line = c.buf.slice(0, i);
      c.buf = c.buf.slice(i + 1);
      if (!line.trim()) continue;
      const w = c.waiters.shift();
      if (!w) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { obj = { ok: false, code: 'bad_response' }; }
      w(obj);
    }
    if (c.buf.length > MAX_MSG * 2) { c.buf = ''; sock.destroy(); }
  });
  const fail = () => {
    if (conn === c) conn = null;
    for (const w of c.waiters.splice(0)) w({ ok: false, code: 'app_unavailable' });
  };
  sock.on('error', fail);
  sock.on('close', fail);
  return c;
}

async function getConn() {
  if (conn && !conn.sock.destroyed) return conn;
  let sock = await tryConnect();
  if (!sock) {
    launchApp();
    const t0 = Date.now();
    while (!sock && Date.now() - t0 < CONNECT_TIMEOUT) {
      await new Promise((r) => setTimeout(r, RETRY_MS));
      sock = await tryConnect();
    }
  }
  if (!sock) return null;
  conn = attach(sock);
  return conn;
}

async function forward(msg) {
  const c = await getConn();
  if (!c) return { ok: false, code: 'app_unavailable' };
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish({ ok: false, code: 'timeout' }), REPLY_TIMEOUT);
    function finish(v) { if (done) return; done = true; clearTimeout(timer); resolve(v); }
    c.waiters.push(finish);
    c.sock.write(JSON.stringify(msg) + '\n');
  });
}

// ---- stdin okuma: mesajlar sırayla işlenir ----
let inBuf = Buffer.alloc(0);
let skip = 0; // sınırı aşan mesajın atlanacak kalan baytları
let chain = Promise.resolve();
let pending = 0;
let ending = false;

function maybeExit() {
  if (ending && pending === 0) {
    if (conn) conn.sock.destroy();
    process.exit(0);
  }
}

function enqueue(job) {
  pending++;
  chain = chain.then(job).catch((e) => log('hata:', e && e.message)).then(() => { pending--; maybeExit(); });
}

function pump() {
  for (;;) {
    if (skip > 0) {
      const n = Math.min(skip, inBuf.length);
      inBuf = inBuf.subarray(n);
      skip -= n;
      if (skip > 0) return;
    }
    if (inBuf.length < 4) return;
    const len = inBuf.readUInt32LE(0);
    if (len > MAX_MSG) {
      inBuf = inBuf.subarray(4);
      skip = len;
      enqueue(() => writeFrame({ ok: false, code: 'too_large' }));
      continue;
    }
    if (inBuf.length < 4 + len) return;
    const body = inBuf.subarray(4, 4 + len).toString('utf8');
    inBuf = inBuf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { msg = null; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      enqueue(() => writeFrame({ ok: false, code: 'bad_request' }));
      continue;
    }
    enqueue(async () => writeFrame(await forward(msg)));
  }
}

process.stdin.on('data', (chunk) => {
  inBuf = inBuf.length ? Buffer.concat([inBuf, chunk]) : chunk;
  pump();
});
process.stdin.on('end', () => { ending = true; maybeExit(); });
process.stdin.on('error', () => { ending = true; maybeExit(); });
process.stdout.on('error', () => process.exit(0)); // tarayıcı borusu kapandı
