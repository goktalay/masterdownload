'use strict';

// Testler için gerçek yerel HTTP sunucusu. Yollar:
//   /file/<ad>?size=N            Range destekli dosya (içerik belirlenimci, ETag'li)
//   /norange/<ad>?size=N         Range yok sayılır (200 + tamamı)
//   /flaky/<ad>?size=N&cut=K     her yanıt K bayt sonra kopar (ilk 'fails' istek), sonra düzgün
//   /slow/<ad>?size=N&bps=B      yavaş gönderim
//   /redirect?to=<yol>           302
//   /cookie/<ad>?size=N          Cookie: sid=ok yoksa 403
//   /basic/<ad>?size=N           Temel kimlik doğrulama (u:p)
//   /digest/<ad>?size=N          Digest kimlik doğrulama (u:p)
//   /gone                        404
//   /disposition?size=N          Content-Disposition: attachment; filename*=UTF-8''...
//   /static/<yol>                setStatic ile verilen metin/ikili içerik

const http = require('http');
const crypto = require('crypto');

function content(size, seed = 7) {
  const b = Buffer.allocUnsafe(size);
  let x = seed;
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; }
  return b;
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function startServer() {
  const stats = { requests: 0, ranges: [], byPath: {} };
  const statics = new Map();
  let flakyLeft = {};
  let etagSuffix = '';
  const cache = new Map();
  const body = (size) => { if (!cache.has(size)) cache.set(size, content(size)); return cache.get(size); };

  function sendRange(req, res, buf, { range = true, extra = {}, bps = 0, cut = 0 } = {}) {
    const etag = `"e${buf.length}${etagSuffix}"`;
    let start = 0, end = buf.length - 1, status = 200;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range && m) {
      start = m[1] === '' ? buf.length - Number(m[2]) : Number(m[1]);
      end = m[2] === '' || m[1] === '' ? buf.length - 1 : Math.min(Number(m[2]), buf.length - 1);
      if (req.headers['if-range'] && req.headers['if-range'] !== etag) { start = 0; end = buf.length - 1; }
      else if (start >= buf.length) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
      else status = 206;
      stats.ranges.push(req.headers.range);
    }
    const headers = { 'Content-Length': end - start + 1, 'Content-Type': 'application/octet-stream', ETag: etag, ...extra };
    if (range) headers['Accept-Ranges'] = 'bytes';
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${buf.length}`;
    res.writeHead(status, headers);
    const slice = buf.subarray(start, end + 1);
    if (cut) { res.write(slice.subarray(0, Math.min(cut, slice.length))); setTimeout(() => res.destroy(), 20); return; }
    if (!bps) return res.end(slice);
    let off = 0;
    const tick = 50;
    const per = Math.max(1, Math.round((bps * tick) / 1000));
    const iv = setInterval(() => {
      if (res.destroyed) return clearInterval(iv);
      const c = slice.subarray(off, off + per);
      off += c.length;
      if (off >= slice.length) { clearInterval(iv); res.end(c); } else res.write(c);
    }, tick);
    res.on('close', () => clearInterval(iv));
  }

  const server = http.createServer((req, res) => {
    stats.requests++;
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    stats.byPath[p] = (stats.byPath[p] || 0) + 1;
    const size = Number(u.searchParams.get('size') || 1024);
    if (p.startsWith('/static/')) {
      const s = statics.get(p.slice(7));
      if (!s) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': s.type || 'application/octet-stream', 'Content-Length': Buffer.byteLength(s.body) });
      return res.end(s.body);
    }
    if (p.startsWith('/file/')) return sendRange(req, res, body(size));
    if (p.startsWith('/norange/')) return sendRange(req, res, body(size), { range: false });
    if (p.startsWith('/slow/')) return sendRange(req, res, body(size), { bps: Number(u.searchParams.get('bps')) });
    if (p.startsWith('/flaky/')) {
      const key = p;
      if (flakyLeft[key] === undefined) flakyLeft[key] = Number(u.searchParams.get('fails') || 3);
      const cut = flakyLeft[key] > 0 ? Number(u.searchParams.get('cut') || 1000) : 0;
      if (cut) flakyLeft[key]--;
      return sendRange(req, res, body(size), { cut });
    }
    if (p === '/redirect') { res.writeHead(302, { Location: u.searchParams.get('to') }); return res.end(); }
    if (p.startsWith('/cookie/')) {
      if (!/sid=ok/.test(req.headers.cookie || '')) { res.writeHead(403); return res.end(); }
      return sendRange(req, res, body(size));
    }
    if (p.startsWith('/basic/')) {
      if (req.headers.authorization !== `Basic ${Buffer.from('u:p').toString('base64')}`) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="t"' }); return res.end();
      }
      return sendRange(req, res, body(size));
    }
    if (p.startsWith('/digest/')) {
      const a = req.headers.authorization || '';
      if (!a.startsWith('Digest ')) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="t", qop="auth", nonce="abc123", opaque="xyz"' }); return res.end();
      }
      const prm = {};
      a.slice(7).replace(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g, (_m, k, v1, v2) => { prm[k] = v1 ?? v2; });
      const H = (s) => crypto.createHash('md5').update(s).digest('hex');
      const ha1 = H(`u:t:p`), ha2 = H(`${req.method}:${prm.uri}`);
      const expect = H(`${ha1}:${prm.nonce}:${prm.nc}:${prm.cnonce}:${prm.qop}:${ha2}`);
      if (prm.response !== expect) { res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="t", qop="auth", nonce="abc123"' }); return res.end(); }
      return sendRange(req, res, body(size));
    }
    if (p === '/gone') { res.writeHead(404); return res.end(); }
    if (p === '/disposition') return sendRange(req, res, body(size), { extra: { 'Content-Disposition': "attachment; filename=\"fallback.bin\"; filename*=UTF-8''%C3%B6rnek%20dosya.zip" } });
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base, stats, server, body, sha,
        setStatic: (p, b, type) => statics.set(p, { body: b, type }),
        resetFlaky: () => { flakyLeft = {}; },
        changeEtag: (s) => { etagSuffix = s; },
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { startServer, content, sha };
