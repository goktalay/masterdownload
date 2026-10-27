'use strict';

// Site yakalayıcı (basit): başlangıç sayfasından belirli derinliğe kadar HTML sayfalarını gezer, istenen türdeki
// dosya bağlantılarını toplar. Sitenin robots.txt kurallarına uyar, istekler arasında bekler, sayfa sınırı vardır.
// Toplanan liste kullanıcıya gösterilir; seçilenler indirme listesine eklenir.

const UA_TOKEN = 'masterdownload';

// robots.txt → izin denetleyici. "User-agent: *" ve bizim adımızın grupları; en uzun eşleşen kural kazanır.
function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  const toRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
  const compiled = rules.filter((r) => r.path).map((r) => ({ ...r, re: toRe(r.path), len: r.path.length }));
  return (pathAndQuery) => {
    let best = null;
    for (const r of compiled) if (r.re.test(pathAndQuery) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
    return !best || best.allow;
  };
}

function extractHrefs(html, baseUrl) {
  const out = [];
  const re = /<(a|area|link|img|source|video|audio|embed|iframe|frame)\b[^>]*?\b(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  let base = baseUrl;
  const b = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html);
  if (b) { try { base = new URL(b[1], baseUrl).href; } catch { /* yok say */ } }
  while ((m = re.exec(html))) {
    const raw = (m[4] ?? m[5] ?? m[6] ?? '').replace(/&amp;/g, '&').trim();
    if (!raw || /^(javascript|mailto|data|tel):/i.test(raw) || raw.startsWith('#')) continue;
    try {
      const u = new URL(raw, base);
      u.hash = '';
      if (/^(https?|ftp):$/.test(u.protocol)) out.push({ url: u.href, tag: m[1].toLowerCase() });
    } catch { /* geçersiz */ }
  }
  return out;
}

const extOfUrl = (u) => ((new URL(u).pathname.toLowerCase().match(/\.([a-z0-9]{1,12})$/) || [])[1] || '');
const PAGE_EXTS = new Set(['', 'html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml', 'cgi']);

// opts: { startUrl, depth (0 = yalnız başlangıç sayfası), exts: ['zip',…] (boş = sayfa olmayan her şey),
//         scope: 'host'|'path'|'any' (sayfa gezinme sınırı; dosyalar her yerden alınabilir), maxPages, delayMs,
//         fetchText(url) → {text, url, headers}, signal, onProgress({pages, files, url}) }
async function grab(opts) {
  const { startUrl, depth = 1, exts = [], scope = 'host', maxPages = 200, delayMs = 300, fetchText, signal, onProgress = () => {} } = opts;
  const start = new URL(startUrl);
  const prefix = start.pathname.replace(/[^/]*$/, '');
  const robots = new Map(); // origin → izin fonksiyonu
  async function allowed(u) {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return true;
    if (!robots.has(url.origin)) {
      let check = () => true;
      try { check = parseRobots((await fetchText(`${url.origin}/robots.txt`)).text); } catch { /* robots.txt yok: serbest */ }
      robots.set(url.origin, check);
    }
    return robots.get(url.origin)(url.pathname + url.search);
  }
  const inScope = (u) => {
    const x = new URL(u);
    if (scope === 'any') return true;
    if (x.host !== start.host) return false;
    return scope === 'path' ? x.pathname.startsWith(prefix) : true;
  };
  const want = (u) => {
    const e = extOfUrl(u);
    if (exts.length) return exts.includes(e);
    return !PAGE_EXTS.has(e);
  };

  const seenPages = new Set();
  const files = new Map();
  const skipped = [];
  let queue = [{ url: start.href, d: 0 }];
  let pages = 0;
  while (queue.length && pages < maxPages) {
    if (signal && signal.aborted) break;
    const { url, d } = queue.shift();
    if (seenPages.has(url)) continue;
    seenPages.add(url);
    if (!(await allowed(url))) { skipped.push(url); continue; }
    let page;
    try {
      if (pages > 0 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
      page = await fetchText(url);
    } catch { continue; }
    pages++;
    const ctype = String((page.headers || {})['content-type'] || 'text/html');
    if (!/html|xml/i.test(ctype)) continue;
    for (const { url: link, tag } of extractHrefs(page.text, page.url || url)) {
      if (want(link)) {
        if (!files.has(link) && (await allowed(link))) files.set(link, { url: link, ext: extOfUrl(link), page: page.url || url });
      } else if (d < depth && (tag === 'a' || tag === 'frame' || tag === 'iframe' || tag === 'area') && PAGE_EXTS.has(extOfUrl(link)) && inScope(link) && !seenPages.has(link)) {
        queue.push({ url: link, d: d + 1 });
      }
    }
    onProgress({ pages, files: files.size, url });
  }
  return { files: [...files.values()], pages, skipped };
}

module.exports = { grab, parseRobots, extractHrefs };
