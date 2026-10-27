'use strict';

// FTP taşıyıcısı (bağımlılıksız küçük istemci): task.js'nin kullandığı arayüz (bkz. transport-http.js):
//   probe({signal}) → { size, resumable, etag, lastModified, finalUrl, headers, first: null }
//   open({start, end, signal}) → async-iterable Readable (veri bağlantısı); destroy() edilince kontrol bağlantısı ABOR + QUIT ile kapanır
//
// Her bölüm kendi kontrol bağlantısını açar (USER/PASS → TYPE I → EPSV, olmazsa PASV → REST <pos> → RETR).
// Kimlik adresten (ftp://kullanıcı:parola@sunucu/yol) ya da opts.auth'tan; yoksa anonymous.
// Veri bağlantısı her zaman kontrol bağlantısının sunucusuna açılır (PASV'deki IP yok sayılır: NAT arkasındaki
// sunucular yanlış IP bildirir, ayrıca FTP "bounce" saldırısına kapı açmaz).
// Proxy desteklenmez (düz FTP doğrudan bağlanır). FTPS sonra.

const net = require('net');

class FtpError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

// FTP yanıt kodundan hata: 530 kimlik, 550 bulunamadı, 4xx geçici, 5xx kalıcı
function replyError(r, what) {
  const msg = `${what}: ${r.code} ${r.text}`;
  if (r.code === 530 || r.code === 332) return new FtpError('auth_required', msg, { status: r.code, transient: false });
  if (r.code === 550 || r.code === 450) return new FtpError('not_found', msg, { status: r.code, transient: r.code === 450 });
  if (r.code >= 400 && r.code < 500) return new FtpError('network', msg, { status: r.code, transient: true });
  return new FtpError(`ftp_${r.code}`, msg, { status: r.code, transient: false });
}

// --- Kontrol bağlantısı ------------------------------------------------------
// Satır tabanlı yanıt ayrıştırma; çok satırlı yanıtlar ("123-" … "123 ") tek yanıt sayılır.
function openControl({ host, port, timeout, signal }) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new FtpError('aborted', 'aborted'));
    const sock = net.connect({ host, port });
    sock.setNoDelay(true);
    let buf = '';
    let multi = null; // çok satırlı yanıtın kodu
    let lines = [];
    const replies = [];
    const waiters = [];
    let dead = null;

    const fail = (e) => {
      if (dead) return;
      dead = e;
      while (waiters.length) { const w = waiters.shift(); clearTimeout(w.t); w.reject(e); }
    };
    const onAbort = () => { fail(new FtpError('aborted', 'aborted')); sock.destroy(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        lines.push(line);
        const m = /^(\d{3})([ -])/.exec(line);
        if (multi === null) {
          if (!m) { lines = []; continue; } // beklenmeyen satır
          if (m[2] === '-') { multi = m[1]; continue; }
        } else if (!(m && m[1] === multi && m[2] === ' ')) continue;
        const code = Number(line.slice(0, 3));
        const r = { code, text: lines.map((l) => l.replace(/^\d{3}[ -]?/, '')).join('\n').trim() };
        multi = null;
        lines = [];
        const w = waiters.shift();
        if (w) { clearTimeout(w.t); w.resolve(r); } else replies.push(r);
      }
    });
    sock.on('error', (e) => fail(new FtpError(e.code === 'ECONNREFUSED' ? 'refused' : 'network', e.message, { transient: true })));
    sock.on('close', () => {
      fail(new FtpError('network', 'control connection closed', { transient: true }));
      if (signal) signal.removeEventListener('abort', onAbort);
    });

    const read = () => {
      if (replies.length) return Promise.resolve(replies.shift());
      if (dead) return Promise.reject(dead);
      return new Promise((res, rej) => {
        const w = { resolve: res, reject: rej, t: null };
        w.t = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          rej(new FtpError('timeout', 'ftp reply timeout', { transient: true }));
          sock.destroy();
        }, timeout);
        waiters.push(w);
      });
    };
    const write = (line) => { if (!sock.destroyed) sock.write(`${line}\r\n`); };
    const send = (line) => { write(line); return read(); };
    // Kibar kapanış: (gerekirse ABOR) + QUIT, sonra soket kapanır; yanıt beklenmez
    const close = (abort = false) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (sock.destroyed) return;
      if (abort) write('ABOR');
      write('QUIT');
      sock.end();
      setTimeout(() => sock.destroy(), 2000).unref();
    };

    // Kurulum bitince iptal sinyali bırakılır: akış kapanışı close(true) ile kibarca (ABOR + QUIT) yapılır
    const detach = () => { if (signal) signal.removeEventListener('abort', onAbort); };
    const ctl = { sock, read, write, send, close, detach, host };
    const t = setTimeout(() => { sock.destroy(); reject(new FtpError('timeout', 'connect timeout', { transient: true })); }, timeout);
    sock.once('connect', () => {
      clearTimeout(t);
      read().then((greet) => {
        if (greet.code !== 220) { close(); return reject(replyError(greet, 'greeting')); }
        resolve(ctl);
      }, reject);
    });
    sock.once('error', (e) => { clearTimeout(t); reject(new FtpError(e.code === 'ECONNREFUSED' ? 'refused' : 'network', e.message, { transient: true })); });
  });
}

async function login(ctl, user, pass) {
  let r = await ctl.send(`USER ${user}`);
  if (r.code === 331 || r.code === 332) r = await ctl.send(`PASS ${pass}`);
  if (r.code !== 230 && r.code !== 202) throw replyError(r, 'login');
  r = await ctl.send('TYPE I');
  if (r.code !== 200) throw replyError(r, 'TYPE I');
}

// Pasif kip: önce EPSV (IPv6/NAT dostu), desteklenmezse PASV. Dönen: veri portu
async function passive(ctl) {
  let r = await ctl.send('EPSV');
  if (r.code === 229) {
    const m = /\(([^\d])\1\1(\d+)\1\)/.exec(r.text);
    if (m) return Number(m[2]);
  }
  r = await ctl.send('PASV');
  if (r.code !== 227) throw replyError(r, 'PASV');
  const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(r.text);
  if (!m) throw new FtpError('ftp_protocol', `bad PASV reply: ${r.text}`, { transient: false });
  return Number(m[5]) * 256 + Number(m[6]);
}

function connectData(host, port, timeout, signal) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(new FtpError('timeout', 'data connect timeout', { transient: true })); }, timeout);
    const onAbort = () => { s.destroy(); reject(new FtpError('aborted', 'aborted')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    s.once('connect', () => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); reject(new FtpError('network', e.message, { transient: true })); });
  });
}

// MDTM yanıtı (YYYYMMDDHHMMSS[.sss], UTC) → HTTP tarihi biçimi (Last-Modified ile aynı)
function mdtmToDate(text) {
  const m = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(text || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

function parseFtpUrl(url, auth) {
  const u = new URL(url);
  if (u.protocol !== 'ftp:') throw new FtpError('unsupported_protocol', u.protocol, { transient: false });
  // RFC 1738: yol giriş klasörüne görelidir; %2F ile başlayan yol mutlaktır
  const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!path || path.endsWith('/')) throw new FtpError('not_found', 'no file in ftp url', { transient: false });
  const user = auth && auth.user ? auth.user : u.username ? decodeURIComponent(u.username) : 'anonymous';
  const pass = auth && auth.user ? auth.pass || '' : u.username ? decodeURIComponent(u.password) : 'anonymous@';
  return { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 21, path, user, pass };
}

function createFtpTransport(opts) {
  const { url, auth = null, timeout = 30000 } = opts;
  const target = parseFtpUrl(url, auth);
  let validators = {};

  async function session(signal) {
    const ctl = await openControl({ host: target.host, port: target.port, timeout, signal });
    try {
      await login(ctl, target.user, target.pass);
    } catch (e) {
      ctl.close();
      throw e;
    }
    return ctl;
  }

  async function probe({ signal } = {}) {
    const ctl = await session(signal);
    try {
      let size = null;
      let r = await ctl.send(`SIZE ${target.path}`);
      if (r.code === 213) size = Number(r.text.trim().split(/\s+/).pop());
      else if (r.code === 550) throw replyError(r, 'SIZE');
      if (!Number.isFinite(size)) size = null;
      r = await ctl.send(`MDTM ${target.path}`);
      const lastModified = r.code === 213 ? mdtmToDate(r.text) : null;
      // REST desteği: 350 dönerse bölümlü/sürdürülebilir. Konum sonraki RETR'ye kadar geçerli olduğundan sıfırlanır.
      r = await ctl.send('REST 1');
      const resumable = r.code === 350 && size != null;
      if (r.code === 350) await ctl.send('REST 0');
      validators = { etag: null, lastModified };
      ctl.close();
      return { size, resumable, ...validators, finalUrl: url, headers: {}, first: null };
    } catch (e) {
      ctl.close();
      throw e;
    }
  }

  async function open({ start = 0, signal } = {}) {
    const ctl = await session(signal);
    let data = null;
    try {
      const port = await passive(ctl);
      data = await connectData(ctl.host, port, timeout, signal);
      if (start > 0) {
        const r = await ctl.send(`REST ${start}`);
        if (r.code !== 350) throw new FtpError('changed', `REST rejected: ${r.code} ${r.text}`, { transient: false });
      }
      const r = await ctl.send(`RETR ${target.path}`);
      if (r.code !== 150 && r.code !== 125) throw replyError(r, 'RETR');
    } catch (e) {
      if (data) data.destroy();
      ctl.close();
      throw e;
    }
    ctl.detach();
    // Aktarım bitince (226) ya da akış erken kapatılınca kontrol bağlantısı kapanır
    let finished = false;
    data.once('end', () => { finished = true; });
    data.once('close', () => ctl.close(!finished));
    // Kontrol bağlantısındaki aktarım hatası (ör. 426) veri akışını hatayla sonlandırır
    ctl.read().then((fin) => {
      if (fin.code >= 400 && !data.destroyed) data.destroy(replyError(fin, 'transfer'));
    }, () => {});
    return data;
  }

  return { kind: 'ftp', probe, open, get finalUrl() { return url; }, get validators() { return validators; } };
}

module.exports = { createFtpTransport, parseFtpUrl, mdtmToDate, FtpError };
