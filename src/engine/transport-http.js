'use strict';

// HTTP/HTTPS taşıyıcısı: ilk yoklama ve bölüm akışları. task.js bu arayüzü kullanır:
//   probe({signal}) → { size, resumable, etag, lastModified, finalUrl, headers, first }
//       first: 0. bayttan başlayan açık akış (yeni indirmede ilk bölüm için yeniden kullanılır) — kullanılmazsa destroy edilir
//   open({start, end, signal}) → async-iterable akış (destroy() ile kapatılır)

const { request, createJar, HttpError } = require('./http');

function createHttpTransport(opts) {
  const { url, referrer = '', cookies = '', userAgent = '', auth = null, headers = {}, proxy = null, resolveProxy = null, timeout = 30000 } = opts;
  const jar = createJar(cookies);
  let finalUrl = url;
  let validators = {};

  const common = () => ({ jar, auth, referrer, userAgent, headers, proxy, resolveProxy, timeout });

  async function probe({ signal } = {}) {
    const { res, url: u } = await request(url, { ...common(), range: 'bytes=0-', signal });
    finalUrl = u;
    let size = null;
    let resumable = false;
    if (res.statusCode === 206) {
      const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(res.headers['content-range'] || '');
      if (m && m[1] === '0' && m[3] !== '*') { size = Number(m[3]); resumable = true; }
      else if (m && m[1] === '0') size = null;
    } else {
      const cl = Number(res.headers['content-length']);
      size = Number.isFinite(cl) && res.headers['content-length'] !== undefined ? cl : null;
    }
    // Sıkıştırılmış aktarım bölümlenemez
    if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') resumable = false;
    validators = { etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null };
    return { size, resumable, ...validators, finalUrl, headers: res.headers, first: res };
  }

  async function open({ start, end, signal }) {
    const range = end === Infinity || end == null ? (start > 0 ? `bytes=${start}-` : null) : `bytes=${start}-${end}`;
    const h = {};
    // Dosya bu arada değiştiyse sunucu 200 ile tamamını döner; aşağıda yakalanır
    if (range && validators.etag && !/^W\//.test(validators.etag)) h['If-Range'] = validators.etag;
    else if (range && validators.lastModified) h['If-Range'] = validators.lastModified;
    const { res } = await request(finalUrl, { ...common(), headers: { ...headers, ...h }, range, signal });
    if (range && res.statusCode !== 206) {
      res.destroy();
      throw new HttpError('changed', 'server ignored range (file changed?)', { transient: false });
    }
    return res;
  }

  return { kind: 'http', probe, open, get finalUrl() { return finalUrl; } };
}

module.exports = { createHttpTransport };
