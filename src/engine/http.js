'use strict';

// HTTP/HTTPS isteği: yönlendirme, çerez, Temel/Digest kimlik doğrulama, HTTP (CONNECT) ve SOCKS5 proxy, zaman aşımı.
// Electron'a bağlı değildir; sistem proxy'si dışarıdan resolveProxy(url) → "PROXY h:p; DIRECT" biçiminde verilir.

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const MAX_REDIRECTS = 10;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 MasterDownload/1';

class HttpError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

// Kalıcı (4xx) hatalar yeniden denenmez; 408/429 ve 5xx geçicidir
const isTransientStatus = (s) => s === 408 || s === 425 || s === 429 || s >= 500;

// --- Çerezler (basit kavanoz: ad=değer, alan adına bağlı) -----------------
function createJar(initial = '') {
  const map = new Map(); // host → Map(name → value)
  const base = parseCookieHeader(initial);
  return {
    header(url) {
      const host = new URL(url).hostname;
      const out = new Map(base);
      for (const [h, m] of map) if (host === h || host.endsWith(`.${h}`)) for (const [k, v] of m) out.set(k, v);
      return [...out].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    store(url, setCookie) {
      if (!setCookie) return;
      const host = new URL(url).hostname;
      for (const line of [].concat(setCookie)) {
        const [pair, ...attrs] = String(line).split(';');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        let domain = host;
        for (const a of attrs) {
          const m = /^\s*domain\s*=\s*\.?(.+)$/i.exec(a);
          if (m) domain = m[1].trim().toLowerCase();
        }
        if (!map.has(domain)) map.set(domain, new Map());
        map.get(domain).set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

function parseCookieHeader(s) {
  const m = new Map();
  for (const part of String(s || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) m.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return m;
}

// --- Kimlik doğrulama ------------------------------------------------------
function parseAuthHeader(h) {
  const m = /^\s*(\w+)\s+(.*)$/.exec(String(h || ''));
  if (!m) return null;
  const params = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  let x;
  while ((x = re.exec(m[2]))) params[x[1].toLowerCase()] = x[2] !== undefined ? x[2] : x[3];
  return { scheme: m[1].toLowerCase(), params };
}

function pickChallenge(headers) {
  const all = [].concat(headers['www-authenticate'] || []);
  const parsed = all.map(parseAuthHeader).filter(Boolean);
  return parsed.find((c) => c.scheme === 'digest') || parsed.find((c) => c.scheme === 'basic') || null;
}

let nc = 0;
function authorization(challenge, { user, pass }, method, url) {
  if (!challenge || user == null) return null;
  if (challenge.scheme === 'basic') return `Basic ${Buffer.from(`${user}:${pass || ''}`).toString('base64')}`;
  if (challenge.scheme !== 'digest') return null;
  const p = challenge.params;
  const algo = (p.algorithm || 'MD5').toUpperCase();
  const hashName = algo.startsWith('SHA-256') ? 'sha256' : 'md5';
  const H = (s) => crypto.createHash(hashName).update(s).digest('hex');
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ncs = (++nc).toString(16).padStart(8, '0');
  let ha1 = H(`${user}:${p.realm}:${pass || ''}`);
  if (algo.endsWith('-SESS')) ha1 = H(`${ha1}:${p.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const qop = p.qop ? p.qop.split(',').map((s) => s.trim()).find((q) => q === 'auth') : null;
  const response = qop ? H(`${ha1}:${p.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${p.nonce}:${ha2}`);
  const parts = [`username="${user}"`, `realm="${p.realm}"`, `nonce="${p.nonce}"`, `uri="${uri}"`, `algorithm=${algo}`, `response="${response}"`];
  if (p.opaque) parts.push(`opaque="${p.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${ncs}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

// --- Proxy -----------------------------------------------------------------
// proxy: { type: 'http'|'socks5', host, port, user, pass } | null
function parsePacResult(s) {
  for (const entry of String(s || '').split(';')) {
    const m = /^\s*(PROXY|HTTPS|SOCKS5?|SOCKS4)\s+([^\s:]+):(\d+)/i.exec(entry);
    if (m) return { type: /^SOCKS/i.test(m[1]) ? 'socks5' : 'http', host: m[2], port: Number(m[3]) };
    if (/^\s*DIRECT/i.test(entry)) return null;
  }
  return null;
}

function connectSocket(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(new HttpError('timeout', 'connect timeout')); }, timeout);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(new HttpError('network', e.message)); });
  });
}

function readExactly(sock, n) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= n) {
        sock.removeListener('data', onData);
        sock.removeListener('error', onErr);
        if (buf.length > n) sock.unshift(buf.subarray(n));
        resolve(buf.subarray(0, n));
      }
    };
    const onErr = (e) => { sock.removeListener('data', onData); reject(new HttpError('proxy', e.message)); };
    sock.on('data', onData);
    sock.once('error', onErr);
  });
}

async function socks5Tunnel(proxy, host, port, timeout) {
  const s = await connectSocket(proxy.host, proxy.port, timeout);
  const withAuth = proxy.user != null && proxy.user !== '';
  s.write(Buffer.from(withAuth ? [5, 2, 0, 2] : [5, 1, 0]));
  const sel = await readExactly(s, 2);
  if (sel[0] !== 5 || sel[1] === 0xff) throw new HttpError('proxy', 'socks5 method rejected');
  if (sel[1] === 2) {
    const u = Buffer.from(String(proxy.user)), p = Buffer.from(String(proxy.pass || ''));
    s.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
    const r = await readExactly(s, 2);
    if (r[1] !== 0) throw new HttpError('proxy_auth', 'socks5 auth failed');
  }
  const h = Buffer.from(host);
  s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));
  const head = await readExactly(s, 4);
  if (head[1] !== 0) throw new HttpError('proxy', `socks5 connect failed (${head[1]})`);
  const alen = head[3] === 1 ? 4 : head[3] === 4 ? 16 : (await readExactly(s, 1))[0];
  await readExactly(s, alen + 2);
  return s;
}

async function httpConnectTunnel(proxy, host, port, timeout) {
  const s = await connectSocket(proxy.host, proxy.port, timeout);
  const auth = proxy.user ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.user}:${proxy.pass || ''}`).toString('base64')}\r\n` : '';
  s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
  const head = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString('latin1');
      const i = buf.indexOf('\r\n\r\n');
      if (i >= 0) {
        s.removeListener('data', onData);
        if (buf.length > i + 4) s.unshift(Buffer.from(buf.slice(i + 4), 'latin1'));
        resolve(buf.slice(0, i));
      }
    };
    s.on('data', onData);
    s.once('error', (e) => reject(new HttpError('proxy', e.message)));
  });
  const code = Number((/^HTTP\/\d\.\d\s+(\d+)/.exec(head) || [])[1]);
  if (code === 407) throw new HttpError('proxy_auth', 'proxy authentication required');
  if (code !== 200) throw new HttpError('proxy', `proxy CONNECT ${code}`);
  return s;
}

// --- Tek istek (yönlendirmesiz) ------------------------------------------
async function rawRequest(url, { method = 'GET', headers = {}, proxy = null, timeout = 30000, signal } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError('unsupported_protocol', u.protocol);
  const secure = u.protocol === 'https:';
  const port = Number(u.port) || (secure ? 443 : 80);
  const opts = { method, headers: { Host: u.host, ...headers }, timeout };
  let path = u.pathname + u.search;

  if (proxy && proxy.type === 'http' && !secure) {
    // Düz HTTP: proxy'ye tam adresle istek
    Object.assign(opts, { host: proxy.host, port: proxy.port });
    path = u.href;
    if (proxy.user) opts.headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${proxy.user}:${proxy.pass || ''}`).toString('base64')}`;
  } else if (proxy) {
    const sock = proxy.type === 'socks5' ? await socks5Tunnel(proxy, u.hostname, port, timeout) : await httpConnectTunnel(proxy, u.hostname, port, timeout);
    const conn = secure ? tls.connect({ socket: sock, servername: net.isIP(u.hostname) ? undefined : u.hostname }) : sock;
    opts.createConnection = () => conn;
    opts.agent = false;
  } else {
    Object.assign(opts, { host: u.hostname, port });
  }
  opts.path = path;
  if (secure) opts.servername = net.isIP(u.hostname) ? undefined : u.hostname;

  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(opts, (res) => {
      req.setTimeout(0);
      resolve(res);
    });
    const onAbort = () => req.destroy(new HttpError('aborted', 'aborted'));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => req.destroy(new HttpError('timeout', 'timeout')));
    req.on('error', (e) => reject(e instanceof HttpError ? e : new HttpError(e.code === 'ECONNREFUSED' ? 'refused' : 'network', e.message)));
    req.end();
  });
}

// --- İstek: yönlendirme + çerez + kimlik doğrulama ---------------------------
// Dönen: { res, url (son adres) }. res.statusCode 2xx dışında ise HttpError atılır (gövde tüketilir).
async function request(url, {
  method = 'GET', headers = {}, range = null, jar = null, auth = null, referrer = '', userAgent = '',
  proxy = null, resolveProxy = null, timeout = 30000, signal, accept2xxOnly = true,
} = {}) {
  let current = url;
  let challenge = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const h = { 'User-Agent': userAgent || DEFAULT_UA, Accept: '*/*', 'Accept-Encoding': 'identity', ...headers };
    if (referrer) h.Referer = referrer;
    if (range) h.Range = range;
    const ck = jar && jar.header(current);
    if (ck) h.Cookie = ck;
    if (challenge && auth) {
      const a = authorization(challenge, auth, method, current);
      if (a) h.Authorization = a;
    } else if (auth && auth.user && auth.preemptive) {
      h.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.pass || ''}`).toString('base64')}`;
    }
    const px = proxy !== undefined && proxy !== null ? proxy : resolveProxy ? parsePacResult(await resolveProxy(current)) : null;
    const res = await rawRequest(current, { method, headers: h, proxy: px, timeout, signal });
    if (jar) jar.store(current, res.headers['set-cookie']);

    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      current = new URL(res.headers.location, current).href;
      challenge = null;
      continue;
    }
    if (res.statusCode === 401 && auth && auth.user && !challenge) {
      challenge = pickChallenge(res.headers);
      res.resume();
      if (challenge) { hop--; continue; }
    }
    if (accept2xxOnly && (res.statusCode < 200 || res.statusCode > 299)) {
      res.resume();
      const code = res.statusCode === 401 ? 'auth_required' : res.statusCode === 403 ? 'forbidden' : res.statusCode === 404 || res.statusCode === 410 ? 'not_found'
        : res.statusCode === 416 ? 'range_not_satisfiable' : `http_${res.statusCode}`;
      throw new HttpError(code, `HTTP ${res.statusCode}`, { status: res.statusCode, transient: isTransientStatus(res.statusCode) });
    }
    return { res, url: current };
  }
  throw new HttpError('too_many_redirects', 'too many redirects');
}

// Gövdeyi metin olarak oku (liste dosyaları, HTML) — en çok maxBytes
async function fetchText(url, opts = {}, maxBytes = 8 * 1024 * 1024) {
  const { res, url: finalUrl } = await request(url, opts);
  const chunks = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > maxBytes) { res.destroy(); throw new HttpError('too_large', 'response too large'); }
    chunks.push(c);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), url: finalUrl, headers: res.headers };
}

async function fetchBuffer(url, opts = {}, maxBytes = 64 * 1024 * 1024) {
  const { res } = await request(url, opts);
  const chunks = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > maxBytes) { res.destroy(); throw new HttpError('too_large', 'response too large'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

module.exports = {
  request, rawRequest, fetchText, fetchBuffer, createJar, parseCookieHeader, parseAuthHeader, authorization,
  parsePacResult, HttpError, isTransientStatus, DEFAULT_UA,
};
