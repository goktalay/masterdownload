/* Master Download eklentisi — saf kurallar (tarayıcı API'si kullanmaz).
 * UMD: tarayıcıda globalThis.MDRules olur (arka plan, içerik betiği, açılır pencere, seçenekler);
 * Node'da require('extension/src/rules.js') ile test edilir. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MDRules = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_EXTS = [
    '7z', 'rar', 'zip', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'zst', 'cab', 'arj', 'lzh', 'ace',
    'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'apk', 'xapk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'bin', 'iso', 'img', 'vhd', 'vhdx',
    'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv',
    'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma',
    'pdf', 'epub', 'djvu', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
    'torrent',
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,        // indirmeleri yakala
    exts: DEFAULT_EXTS,   // yakalanacak uzantılar (noktasız, küçük harf)
    minSizeKB: 0,         // bundan küçük (boyutu bilinen) indirmeler tarayıcıda kalır
    skipSites: [],        // istisna siteler: "example.com", "*.example.com", "*cdn*"
    videoButton: true,    // video üstünde "İndir" düğmesi
  });

  // Kullanım koşulları indirmeyi açıkça yasaklayan ya da içeriği DRM ile koruyan bilinen platformlar.
  // Bu alan adlarında (ve alt alan adlarında) video düğmesi gösterilmez, algılanan medya Master Download'a
  // GÖNDERİLMEZ. Gerekçe: Master Download yalnız doğrudan erişilebilen ve korumasız içeriği indirir
  // (docs/idm-ozellikleri.md §3). YouTube/Twitch/Spotify vb. koşulları akışların indirilmesini yasaklar;
  // Netflix, Disney+, Prime Video, Hulu, Max, Apple TV/Music gibi servisler Widevine/PlayReady/FairPlay kullanır.
  // Aynı liste uygulamada da tutulur (sunucu tarafı denetim).
  const BLOCKED_SITES = [
    'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com',
    'netflix.com', 'nflxvideo.net',
    'disneyplus.com', 'disney-plus.net', 'dssott.com', 'bamgrid.com',
    'primevideo.com', 'amazonvideo.com', 'aiv-cdn.net',
    'hulu.com', 'hulustream.com',
    'max.com', 'hbomax.com', 'hbo.com',
    'spotify.com', 'scdn.co',
    'music.apple.com', 'tv.apple.com',
    'twitch.tv', 'ttvnw.net', 'jtvnw.net',
    'paramountplus.com', 'peacocktv.com', 'crunchyroll.com', 'dazn.com',
    'deezer.com', 'tidal.com', 'music.amazon.com',
    'blutv.com', 'exxen.com', 'gain.tv', 'tabii.com', 'tod.tv', 'puhutv.com',
  ];

  const CAPTURE_PROTOCOLS = ['http:', 'https:', 'ftp:'];
  const MEDIA_MIN_BYTES = 512 * 1024;

  function parseUrl(u) {
    try { return new URL(String(u)); } catch (e) { return null; }
  }

  function hostOf(u) {
    const p = parseUrl(u);
    return p ? p.hostname.toLowerCase() : '';
  }

  // Adres ya da dosya adından uzantı (noktasız, küçük harf); yoksa ''
  function extOf(nameOrUrl) {
    let s = String(nameOrUrl || '');
    const p = /^[a-z][a-z0-9+.-]*:/i.test(s) ? parseUrl(s) : null;
    if (p) {
      s = p.pathname;
      try { s = decodeURIComponent(s); } catch (e) { /* bozuk kodlama: olduğu gibi */ }
    }
    s = s.split(/[?#]/)[0];
    const base = s.split(/[\\/]/).pop();
    const i = base.lastIndexOf('.');
    if (i <= 0 || i === base.length - 1) return '';
    const ext = base.slice(i + 1).toLowerCase();
    return /^[a-z0-9]{1,12}$/.test(ext) ? ext : '';
  }

  function fileNameOf(nameOrUrl) {
    let s = String(nameOrUrl || '');
    const p = /^[a-z][a-z0-9+.-]*:/i.test(s) ? parseUrl(s) : null;
    if (p) {
      s = p.pathname;
      try { s = decodeURIComponent(s); } catch (e) { /* yoksay */ }
    }
    return s.split(/[?#]/)[0].split(/[\\/]/).pop() || '';
  }

  // Joker eşleme: "*" herhangi bir dizi. Desende "*" yoksa alan adı ve alt alan adları eşleşir.
  function matchSite(host, pattern) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    let pat = String(pattern || '').trim().toLowerCase();
    if (!host || !pat) return false;
    // Kullanıcı tam adres yapıştırmış olabilir
    if (/^[a-z]+:\/\//.test(pat)) pat = hostOf(pat) || pat;
    pat = pat.replace(/\/.*$/, '').replace(/\.$/, '');
    if (!pat) return false;
    if (pat.indexOf('*') < 0) return host === pat || host.endsWith('.' + pat);
    const re = new RegExp('^' + pat.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    // "*.example.com" kök alan adını da kapsasın
    if (pat.startsWith('*.') && host === pat.slice(2)) return true;
    return re.test(host);
  }

  function isBlockedSite(host) {
    host = String(host || '').toLowerCase();
    if (host.indexOf('://') >= 0) host = hostOf(host);
    return BLOCKED_SITES.some((d) => matchSite(host, d));
  }

  function isSkippedSite(host, settings) {
    const list = (settings && settings.skipSites) || [];
    return list.some((p) => matchSite(host, p));
  }

  function normalizeExts(v) {
    const arr = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
    const out = [];
    for (const x of arr) {
      const e = String(x || '').trim().toLowerCase().replace(/^\*?\./, '');
      if (/^[a-z0-9]{1,12}$/.test(e) && out.indexOf(e) < 0) out.push(e);
    }
    return out;
  }

  function normalizeSettings(s) {
    s = s || {};
    const d = DEFAULT_SETTINGS;
    const min = Number(s.minSizeKB);
    return {
      enabled: s.enabled === undefined ? d.enabled : !!s.enabled,
      exts: s.exts === undefined ? d.exts.slice() : normalizeExts(s.exts),
      minSizeKB: Number.isFinite(min) && min >= 0 ? Math.floor(min) : d.minSizeKB,
      skipSites: (Array.isArray(s.skipSites) ? s.skipSites : String(s.skipSites || '').split(/[\s,;]+/))
        .map((x) => String(x || '').trim()).filter(Boolean),
      videoButton: s.videoButton === undefined ? d.videoButton : !!s.videoButton,
    };
  }

  /* Tarayıcının başlattığı bir indirme Master Download'a verilsin mi?
   * url: indirme adresi; size: bayt (bilinmiyorsa 0/-1/undefined); altDown: Alt basılıydı (yakalama atlanır);
   * ctrlDown: Ctrl basılıydı (uzantı/boyut koşulları aranmadan zorla yakalanır);
   * filename (isteğe bağlı): tarayıcının belirlediği dosya adı — uzantı adreste yoksa buradan bakılır. */
  function shouldCapture(url, size, settings, altDown, ctrlDown, filename) {
    const p = parseUrl(url);
    if (!p || CAPTURE_PROTOCOLS.indexOf(p.protocol) < 0) return false;
    if (altDown) return false;
    const s = normalizeSettings(settings);
    if (isSkippedSite(p.hostname, s)) return false;
    if (ctrlDown) return true;
    if (!s.enabled) return false;
    const exts = s.exts;
    const e1 = extOf(url);
    const e2 = filename ? extOf(filename) : '';
    if (!((e1 && exts.indexOf(e1) >= 0) || (e2 && exts.indexOf(e2) >= 0))) return false;
    const n = Number(size);
    if (Number.isFinite(n) && n > 0 && n < s.minSizeKB * 1024) return false;
    return true;
  }

  const HLS_MIMES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];
  const DASH_MIMES = ['application/dash+xml'];
  // HLS/DASH parçaları tek başına anlamsızdır: medya listesine dosya olarak alınmaz
  const SEGMENT_EXTS = ['ts', 'm4s', 'm4f', 'cmfv', 'cmfa', 'aac', 'vtt', 'webvtt'];
  const SEGMENT_MIMES = ['video/mp2t', 'video/iso.segment', 'audio/iso.segment'];
  const MEDIA_EXTS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'flv', 'ogv', 'mp3', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wav', 'weba'];

  /* Yanıtın türü: 'hls' | 'dash' | 'file' | null (medya değil). mime parametreli olabilir ("video/mp4; codecs=…"). */
  function detectKind(url, mime) {
    const m = String(mime || '').split(';')[0].trim().toLowerCase();
    const e = extOf(url);
    if (e === 'm3u8' || (e === 'm3u' && m.indexOf('mpegurl') >= 0) || HLS_MIMES.indexOf(m) >= 0) return 'hls';
    if (e === 'mpd' || DASH_MIMES.indexOf(m) >= 0) return 'dash';
    if (SEGMENT_MIMES.indexOf(m) >= 0) return null;
    if (/^(video|audio)\//.test(m)) return SEGMENT_EXTS.indexOf(e) >= 0 ? null : 'file';
    if (MEDIA_EXTS.indexOf(e) >= 0 && (!m || m === 'application/octet-stream' || m === 'binary/octet-stream')) return 'file';
    return null;
  }

  // Medya kaydına değer mi: liste/manifest her zaman; dosya ≥ 512 KB ya da boyutu bilinmiyorsa
  function isMediaWorthy(kind, size) {
    if (!kind) return false;
    if (kind !== 'file') return true;
    const n = Number(size);
    return !(Number.isFinite(n) && n > 0) || n >= MEDIA_MIN_BYTES;
  }

  function cookieHeader(cookies) {
    return (cookies || []).filter((c) => c && c.name).map((c) => `${c.name}=${c.value || ''}`).join('; ');
  }

  // Okunur boyut (1024 tabanlı)
  function formatSize(n) {
    n = Number(n);
    if (!Number.isFinite(n) || n <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? String(n) : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
  }

  return {
    DEFAULT_EXTS, DEFAULT_SETTINGS, BLOCKED_SITES, MEDIA_MIN_BYTES, CAPTURE_PROTOCOLS,
    parseUrl, hostOf, extOf, fileNameOf, matchSite, isBlockedSite, isSkippedSite,
    normalizeExts, normalizeSettings, shouldCapture, detectKind, isMediaWorthy, cookieHeader, formatSize,
  };
}));
