'use strict';

// HLS (m3u8) ayrıştırma. Saf mantık; ağ yoktur (indirme media-task.js'de).
//   parseMaster(text, baseUrl) → { variants:[{url, bandwidth, averageBandwidth, resolution, width, height, codecs, frameRate, audio, name}],
//                                  audio:[{groupId, name, language, url, default}], encrypted }
//   parseMedia(text, baseUrl)  → { segments:[{url, duration, byterange?:{offset,length}}], map:{url, byterange?}|null,
//                                  encrypted, endList, targetDuration, mediaSequence, duration }
// Yasal sınır (docs/idm-ozellikleri.md §3): METHOD≠NONE olan EXT-X-KEY / EXT-X-SESSION-KEY (AES-128, SAMPLE-AES,
// KEYFORMAT'lı DRM) içeren listeler indirilmez — assertPlain() 'encrypted_stream' fırlatır. ENDLIST'siz (canlı)
// liste v1'de indirilmez: 'live_stream'.

class MediaError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    this.transient = false;
    Object.assign(this, extra);
  }
}

// ÖZNİTELİK=DEĞER listesi; tırnaklı değerlerde virgül olabilir
function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) {
    let v = m[2];
    if (v.startsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const lines = (text) => String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const resolve = (uri, base) => new URL(uri, base).href;

function checkHeader(ls) {
  if (ls[0] !== '#EXTM3U') throw new MediaError('bad_playlist', 'not an m3u8 playlist');
}

const isMaster = (text) => /#EXT-X-STREAM-INF/i.test(String(text || ''));

// "n[@o]" → {offset, length}; ofset yoksa aynı kaynaktaki bir önceki aralığın sonundan devam eder
function parseByterange(v, prevEnd) {
  const m = /^(\d+)(?:@(\d+))?$/.exec(String(v).trim());
  if (!m) throw new MediaError('bad_playlist', `bad BYTERANGE ${v}`);
  return { length: Number(m[1]), offset: m[2] !== undefined ? Number(m[2]) : prevEnd || 0 };
}

const keyIsEncrypted = (a) => !!a.METHOD && a.METHOD.toUpperCase() !== 'NONE';

function parseMaster(text, baseUrl) {
  const ls = lines(text);
  checkHeader(ls);
  const variants = [];
  const audio = [];
  let encrypted = false;
  for (let i = 1; i < ls.length; i++) {
    const l = ls[i];
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttrs(l.slice(18));
      let uri = null;
      while (++i < ls.length) { if (!ls[i].startsWith('#')) { uri = ls[i]; break; } }
      if (!uri) break;
      const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
      const bandwidth = Number(a.BANDWIDTH) || 0;
      variants.push({
        url: resolve(uri, baseUrl), bandwidth, averageBandwidth: Number(a['AVERAGE-BANDWIDTH']) || null,
        resolution: a.RESOLUTION || null, width: w || null, height: h || null, codecs: a.CODECS || null,
        frameRate: Number(a['FRAME-RATE']) || null, audio: a.AUDIO || null,
        name: a.NAME || (h ? `${h}p` : bandwidth ? `${Math.round(bandwidth / 1000)} kbps` : `#${variants.length + 1}`),
      });
    } else if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttrs(l.slice(13));
      if ((a.TYPE || '').toUpperCase() === 'AUDIO') {
        audio.push({ groupId: a['GROUP-ID'] || null, name: a.NAME || null, language: a.LANGUAGE || null, url: a.URI ? resolve(a.URI, baseUrl) : null, default: (a.DEFAULT || '').toUpperCase() === 'YES' });
      }
    } else if (l.startsWith('#EXT-X-SESSION-KEY:')) {
      if (keyIsEncrypted(parseAttrs(l.slice(19)))) encrypted = true;
    }
  }
  return { variants, audio, encrypted };
}

function parseMedia(text, baseUrl) {
  const ls = lines(text);
  checkHeader(ls);
  const segments = [];
  let map = null;
  let encrypted = false;
  let endList = false;
  let targetDuration = null;
  let mediaSequence = 0;
  let playlistType = null;
  let dur = null;
  let br = null;
  const rangeEnd = new Map(); // adres → bir önceki aralığın sonu (BYTERANGE ofsetsiz devam)
  for (const l of ls.slice(1)) {
    if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith('#EXT-X-BYTERANGE:')) br = l.slice(17);
    else if (l.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(l.slice(22)) || null;
    else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) mediaSequence = Number(l.slice(22)) || 0;
    else if (l.startsWith('#EXT-X-PLAYLIST-TYPE:')) playlistType = l.slice(21).toUpperCase();
    else if (l === '#EXT-X-ENDLIST') endList = true;
    else if (l.startsWith('#EXT-X-KEY:') || l.startsWith('#EXT-X-SESSION-KEY:')) {
      if (keyIsEncrypted(parseAttrs(l.slice(l.indexOf(':') + 1)))) encrypted = true;
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(l.slice(11));
      if (!a.URI) continue;
      const m = { url: resolve(a.URI, baseUrl) };
      if (a.BYTERANGE) m.byterange = parseByterange(a.BYTERANGE, 0);
      // Ortada başlık değişen (birden çok EXT-X-MAP) liste uç uca eklenerek geçerli bir dosya vermez
      if (map && (map.url !== m.url || JSON.stringify(map.byterange) !== JSON.stringify(m.byterange))) {
        throw new MediaError('unsupported_stream', 'multiple EXT-X-MAP sections');
      }
      map = m;
    } else if (!l.startsWith('#')) {
      const url = resolve(l, baseUrl);
      const seg = { url, duration: dur || 0 };
      if (br !== null) {
        seg.byterange = parseByterange(br, rangeEnd.get(url));
        rangeEnd.set(url, seg.byterange.offset + seg.byterange.length);
      }
      segments.push(seg);
      dur = null;
      br = null;
    }
  }
  const duration = segments.reduce((n, s) => n + s.duration, 0);
  return { segments, map, encrypted, endList, targetDuration, mediaSequence, playlistType, duration };
}

// İndirilebilirlik denetimi: şifreli → 'encrypted_stream', canlı → 'live_stream'
function assertPlain(pl) {
  if (pl.encrypted) throw new MediaError('encrypted_stream', 'stream is encrypted / DRM protected');
  if (pl.endList === false) throw new MediaError('live_stream', 'live streams are not supported');
  if (pl.segments && !pl.segments.length) throw new MediaError('bad_playlist', 'playlist has no segments');
}

// Varyant seçimi: want = varyant adresi (tam ya da göreli) / ad / sıra no; yoksa en yüksek bant genişliği
function pickVariant(variants, want, baseUrl) {
  if (!variants.length) return null;
  if (want !== undefined && want !== null && want !== '') {
    if (typeof want === 'number') return variants[want] || null;
    let abs = null;
    try { abs = new URL(want, baseUrl).href; } catch { /* ad olabilir */ }
    const v = variants.find((x) => x.url === want || x.url === abs || x.name === want || x.resolution === want);
    if (v) return v;
    throw new MediaError('variant_not_found', `variant not found: ${want}`);
  }
  return variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best), variants[0]);
}

module.exports = { parseMaster, parseMedia, parseAttrs, isMaster, assertPlain, pickVariant, MediaError };
