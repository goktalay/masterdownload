'use strict';

// DASH (.mpd) ayrıştırma. Saf mantık; ağ yoktur (indirme media-task.js'de). Bağımlılıksız küçük XML ayrıştırıcı içerir.
//   parseMpd(text, baseUrl, {strict=true}) → { type, live, encrypted, duration, periods:[…] }
//       strict: ContentProtection varsa 'encrypted_stream', type="dynamic" ise 'live_stream' fırlatır (docs/idm-ozellikleri.md §3)
//   listRepresentations(mpd) → [{id, kind:'video'|'audio', bandwidth, width, height, codecs, mime}]   (v1: ilk Period)
//   segmentsFor(rep)         → { init:{url, byterange?}|null, segments:[{url, byterange?, duration?}] }
// Desteklenen adresleme: SegmentTemplate ($Number$, $Time$ + SegmentTimeline, $RepresentationID$, $Bandwidth$, %0Nd biçimi,
// startNumber, duration/timescale), SegmentList (SegmentURL media/mediaRange), SegmentBase/BaseURL (tek dosya).
// BaseURL zinciri MPD → Period → AdaptationSet → Representation sırasıyla çözülür; SegmentTemplate/List öznitelikleri
// dıştan içe kalıtılır.

const { MediaError } = require('./hls');

// --- Küçük XML ayrıştırıcı ----------------------------------------------------
// Düğüm: { name (önek atılmış), qname, attrs, children, text }. Yorum, CDATA, <?xml?>, DOCTYPE desteklenir.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENT[e] !== undefined ? ENT[e] : m;
});

function parseXml(text) {
  const root = { name: '#root', qname: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const s = String(text || '').replace(/^﻿/, '');
  let m;
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      const local = m[2].replace(/^.*:/, '');
      // Kapanış etiketi: eşleşen açılışa kadar yığından çıkar (bozuk iç içelikte hoşgörülü)
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === local) { stack.length = i; break; }
    } else if (m[3] !== undefined) {
      const attrs = {};
      const ar = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = ar.exec(m[4] || ''))) attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
      const node = { name: m[3].replace(/^.*:/, ''), qname: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  if (s.trim() && !root.children.length) throw new MediaError('bad_manifest', 'not xml');
  return root;
}

const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n, name) => kids(n, name)[0] || null;
function findAll(n, name, out = []) {
  for (const c of n.children) { if (c.name === name) out.push(c); findAll(c, name, out); }
  return out;
}

// ISO 8601 süre (PT1H2M3.5S, P1DT2H) → saniye
function parseDuration(s) {
  const m = /^\s*P(?:([\d.]+)Y)?(?:([\d.]+)M)?(?:([\d.]+)W)?(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?\s*$/.exec(String(s || ''));
  if (!m) return null;
  const n = (i) => Number(m[i] || 0);
  return n(1) * 31536000 + n(2) * 2592000 + n(3) * 604800 + n(4) * 86400 + n(5) * 3600 + n(6) * 60 + n(7);
}

const baseOf = (node, parentBase) => {
  const b = kid(node, 'BaseURL');
  return b && b.text.trim() ? new URL(b.text.trim(), parentBase).href : parentBase;
};

// "a-b" → {offset, length}
function parseRange(r) {
  const m = /^\s*(\d+)-(\d+)\s*$/.exec(String(r || ''));
  return m ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : null;
}

function kindOf(as, rep) {
  const ct = (rep.attrs.contentType || as.attrs.contentType || '').toLowerCase();
  if (ct === 'video' || ct === 'audio') return ct;
  const mime = (rep.attrs.mimeType || as.attrs.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const cc = kid(as, 'ContentComponent');
  if (cc && /^(video|audio)$/i.test(cc.attrs.contentType || '')) return cc.attrs.contentType.toLowerCase();
  return null;
}

function parseMpd(text, baseUrl, { strict = true } = {}) {
  const root = parseXml(text);
  const mpd = kid(root, 'MPD');
  if (!mpd) throw new MediaError('bad_manifest', 'no MPD element');
  const type = (mpd.attrs.type || 'static').toLowerCase();
  const live = type === 'dynamic';
  const encrypted = findAll(mpd, 'ContentProtection').length > 0;
  if (strict && encrypted) throw new MediaError('encrypted_stream', 'stream is DRM protected (ContentProtection)');
  if (strict && live) throw new MediaError('live_stream', 'live streams are not supported');
  const duration = parseDuration(mpd.attrs.mediaPresentationDuration);
  const mpdBase = baseOf(mpd, baseUrl);
  const pNodes = kids(mpd, 'Period');
  const periods = pNodes.map((p, i) => {
    const start = parseDuration(p.attrs.start) ?? 0;
    let pdur = parseDuration(p.attrs.duration);
    if (pdur == null) {
      const next = pNodes[i + 1] && parseDuration(pNodes[i + 1].attrs.start);
      pdur = next != null ? next - start : duration != null ? duration - start : null;
    }
    return { id: p.attrs.id || String(i), start, duration: pdur, node: p, base: baseOf(p, mpdBase) };
  });
  return { type, live, encrypted, duration, periods };
}

function listRepresentations(mpd) {
  const period = mpd.periods[0];
  if (!period) return [];
  const out = [];
  for (const as of kids(period.node, 'AdaptationSet')) {
    const asBase = baseOf(as, period.base);
    for (const rep of kids(as, 'Representation')) {
      const kind = kindOf(as, rep);
      if (!kind) continue; // altyazı vb. v1'de yok
      const a = { ...as.attrs, ...rep.attrs };
      const r = {
        id: rep.attrs.id || `${out.length}`, kind, bandwidth: Number(a.bandwidth) || 0,
        width: Number(a.width) || null, height: Number(a.height) || null, codecs: a.codecs || null,
        mime: a.mimeType || (kind === 'audio' ? 'audio/mp4' : 'video/mp4'),
      };
      // segmentsFor için bağlam (sayılamaz: dışa açık alanları kirletmez)
      Object.defineProperty(r, '_ctx', { value: { period, as, rep, base: baseOf(rep, asBase) }, enumerable: false });
      out.push(r);
    }
  }
  return out;
}

// $Ad$ / $Ad%0Nd$ / $$ yerine koyma
function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\$(\w*)(?:%0(\d+)d)?\$/g, (m, name, width) => {
    if (!name) return '$';
    if (vars[name] === undefined) return m;
    const s = String(vars[name]);
    return width ? s.padStart(Number(width), '0') : s;
  });
}

// Period → AdaptationSet → Representation zincirindeki aynı adlı öğeleri dıştan içe birleştirir
function inherited(ctx, name) {
  const chain = [kid(ctx.period.node, name), kid(ctx.as, name), kid(ctx.rep, name)].filter(Boolean);
  if (!chain.length) return null;
  const attrs = Object.assign({}, ...chain.map((n) => n.attrs));
  const child = (cn) => { for (let i = chain.length - 1; i >= 0; i--) { const c = kid(chain[i], cn); if (c) return c; } return null; };
  const childList = (cn) => { for (let i = chain.length - 1; i >= 0; i--) { const c = kids(chain[i], cn); if (c.length) return c; } return []; };
  return { attrs, child, childList };
}

function segmentsFor(rep) {
  const ctx = rep._ctx;
  if (!ctx) throw new MediaError('bad_manifest', 'representation has no context (use listRepresentations)');
  const base = ctx.base;
  const vars = { RepresentationID: rep.id, Bandwidth: rep.bandwidth };
  const periodDur = ctx.period.duration;

  const tpl = inherited(ctx, 'SegmentTemplate');
  if (tpl) {
    const a = tpl.attrs;
    const timescale = Number(a.timescale) || 1;
    const startNumber = a.startNumber !== undefined ? Number(a.startNumber) : 1;
    let init = null;
    if (a.initialization) init = { url: new URL(fillTemplate(a.initialization, vars), base).href };
    else {
      const ini = tpl.child('Initialization');
      if (ini && ini.attrs.sourceURL) init = { url: new URL(fillTemplate(ini.attrs.sourceURL, vars), base).href };
    }
    if (!a.media) {
      if (!init) throw new MediaError('bad_manifest', 'SegmentTemplate without media');
      return { init: null, segments: [init] }; // tek dosya
    }
    const segments = [];
    const push = (number, time, d) => segments.push({
      url: new URL(fillTemplate(a.media, { ...vars, Number: number, Time: time }), base).href, duration: d / timescale,
    });
    const timeline = tpl.child('SegmentTimeline');
    if (timeline) {
      const S = kids(timeline, 'S');
      const end = periodDur != null ? periodDur * timescale + Number(a.presentationTimeOffset || 0) : Infinity;
      let t = 0;
      let n = startNumber;
      S.forEach((s, i) => {
        if (s.attrs.t !== undefined) t = Number(s.attrs.t);
        const d = Number(s.attrs.d);
        if (!(d > 0)) throw new MediaError('bad_manifest', 'SegmentTimeline S without d');
        let r = Number(s.attrs.r || 0);
        if (r < 0) {
          // -1: bir sonraki S'nin t'sine ya da dönem sonuna kadar yinele
          const nextT = S[i + 1] && S[i + 1].attrs.t !== undefined ? Number(S[i + 1].attrs.t) : end;
          if (!Number.isFinite(nextT)) throw new MediaError('bad_manifest', 'open-ended SegmentTimeline');
          r = Math.ceil((nextT - t) / d) - 1;
        }
        for (let k = 0; k <= r; k++) { push(n++, t, d); t += d; }
      });
    } else {
      const d = Number(a.duration);
      if (!(d > 0)) throw new MediaError('bad_manifest', 'SegmentTemplate without duration or SegmentTimeline');
      let count;
      if (a.endNumber !== undefined) count = Number(a.endNumber) - startNumber + 1;
      else if (periodDur != null) count = Math.ceil((periodDur * timescale) / d - 1e-9);
      else throw new MediaError('bad_manifest', 'unknown presentation duration');
      for (let k = 0; k < count; k++) push(startNumber + k, k * d, d);
    }
    return { init, segments };
  }

  const list = inherited(ctx, 'SegmentList');
  if (list) {
    const timescale = Number(list.attrs.timescale) || 1;
    const d = Number(list.attrs.duration) || 0;
    let init = null;
    const ini = list.child('Initialization');
    if (ini) {
      init = { url: ini.attrs.sourceURL ? new URL(ini.attrs.sourceURL, base).href : base };
      const br = parseRange(ini.attrs.range);
      if (br) init.byterange = br;
    }
    const segments = list.childList('SegmentURL').map((su) => {
      const seg = { url: su.attrs.media ? new URL(su.attrs.media, base).href : base };
      const br = parseRange(su.attrs.mediaRange);
      if (br) seg.byterange = br;
      if (d) seg.duration = d / timescale;
      return seg;
    });
    if (!segments.length) throw new MediaError('bad_manifest', 'empty SegmentList');
    return { init, segments };
  }

  // SegmentBase ya da yalnız BaseURL: tek dosya (başlık ve dizin dosyanın içinde)
  return { init: null, segments: [{ url: base, duration: periodDur || undefined }] };
}

const MIME_EXT = { 'video/mp4': '.mp4', 'audio/mp4': '.m4a', 'video/webm': '.webm', 'audio/webm': '.webm' };
const extForMime = (mime) => MIME_EXT[String(mime || '').toLowerCase()] || (/audio/i.test(mime) ? '.m4a' : '.mp4');

// Temsil seçimi: want = temsil id'si; yoksa en yüksek bant genişlikli görüntü, görüntü yoksa ses
function pickRepresentation(reps, want) {
  if (!reps.length) return null;
  if (want !== undefined && want !== null && want !== '') {
    const r = reps.find((x) => x.id === String(want));
    if (!r) throw new MediaError('variant_not_found', `representation not found: ${want}`);
    return r;
  }
  const pool = reps.some((r) => r.kind === 'video') ? reps.filter((r) => r.kind === 'video') : reps;
  return pool.reduce((best, r) => (r.bandwidth > best.bandwidth ? r : best), pool[0]);
}

module.exports = { parseXml, parseMpd, parseDuration, listRepresentations, segmentsFor, fillTemplate, extForMime, pickRepresentation };
