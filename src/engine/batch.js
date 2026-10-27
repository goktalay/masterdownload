'use strict';

// Toplu indirme kalıbı ve metinden bağlantı ayıklama.
//
// Kalıp: adreste bir yer tutucu *  (IDM'deki gibi) ve aralık ayrı verilir:
//   expandPattern('http://x/img*.jpg', { from: 1, to: 100, width: 3 })   → img001.jpg … img100.jpg
//   expandPattern('http://x/part*.zip', { from: 'a', to: 'z' })          → parta.zip … partz.zip
// Ya da köşeli ayraçla adrese gömülü: http://x/img[001-100].jpg, http://x/[a-f].bin, adım: [0-100:5]

const MAX_ITEMS = 10000;

function range({ from, to, step = 1, width = 0 }) {
  const out = [];
  step = Math.max(1, Math.abs(Number(step) || 1));
  if (typeof from === 'string' && /^[a-z]$/i.test(from) && typeof to === 'string' && /^[a-z]$/i.test(to)) {
    const a = from.charCodeAt(0), b = to.charCodeAt(0);
    const dir = a <= b ? 1 : -1;
    for (let c = a; dir > 0 ? c <= b : c >= b; c += dir * step) out.push(String.fromCharCode(c));
    return out;
  }
  const a = Number(from), b = Number(to);
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw Object.assign(new Error('invalid range'), { code: 'invalid_range' });
  const dir = a <= b ? 1 : -1;
  for (let n = a; dir > 0 ? n <= b : n >= b; n += dir * step) {
    out.push(String(n).padStart(width, '0'));
    if (out.length > MAX_ITEMS) throw Object.assign(new Error('too many'), { code: 'too_many' });
  }
  return out;
}

function expandPattern(pattern, opts) {
  pattern = String(pattern || '').trim();
  if (opts && pattern.includes('*')) {
    const i = pattern.indexOf('*');
    return range(opts).map((v) => pattern.slice(0, i) + v + pattern.slice(i + 1));
  }
  const m = /\[([0-9]+|[a-z])-([0-9]+|[a-z])(?::(\d+))?\]/i.exec(pattern);
  if (!m) return pattern ? [pattern] : [];
  const width = /^0\d/.test(m[1]) ? m[1].length : 0;
  const isNum = /^\d/.test(m[1]);
  const vals = range({ from: isNum ? Number(m[1]) : m[1], to: isNum ? Number(m[2]) : m[2], step: m[3] || 1, width });
  // Birden çok ayraç desteklenir (ör. [1-3]/[a-b]): kalanlar özyinelemeyle açılır
  const out = [];
  for (const v of vals) {
    for (const rest of expandPattern(pattern.slice(0, m.index) + v + pattern.slice(m.index + m[0].length))) {
      out.push(rest);
      if (out.length > MAX_ITEMS) throw Object.assign(new Error('too many'), { code: 'too_many' });
    }
  }
  return out;
}

// Serbest metinden (pano, metin dosyası, HTML) http/https/ftp bağlantıları — sırası korunur, yinelenenler atılır
function extractLinks(text) {
  const out = [];
  const seen = new Set();
  const re = /\b(?:https?|ftp):\/\/[^\s"'<>`{}|\\^]+/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const u = m[0].replace(/[),.;:!?\]]+$/, '').replace(/&amp;/g, '&');
    try {
      const href = new URL(u).href;
      if (!seen.has(href)) { seen.add(href); out.push(href); }
    } catch { /* geçersiz */ }
  }
  return out;
}

// Pano izleyicisi için: metin tek bir indirilebilir bağlantı mı (izlenen uzantılardan biriyle biten)
function isDownloadLink(text, exts) {
  const s = String(text || '').trim();
  if (!/^(https?|ftp):\/\/\S+$/i.test(s)) return false;
  try {
    const p = new URL(s).pathname.toLowerCase();
    const ext = (p.match(/\.([a-z0-9]{1,12})$/) || [])[1];
    return !!ext && exts.includes(ext);
  } catch {
    return false;
  }
}

module.exports = { expandPattern, range, extractLinks, isDownloadLink, MAX_ITEMS };
