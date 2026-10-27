'use strict';

// Kategoriler: uzantı → kategori → klasör (IDM'deki Sıkıştırılmış, Belgeler, Müzik, Programlar, Video).
// Kategori: { id, name?, exts: ['zip', …], dir: '' (boşsa <ana klasör>\<kategori adı>), sites?: ['example.com'] }
// Yerleşik kategorilerin adı i18n'den gelir (name boş); kullanıcı kategorilerinin adı kendisindedir.

const path = require('path');
const { extOf } = require('./filename');

const BUILTIN = [
  { id: 'compressed', exts: ['zip', 'rar', '7z', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'z', 'lzh', 'arj', 'cab', 'zst', 'sit', 'sitx', 'iso', 'img'] },
  { id: 'documents', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv', 'epub', 'mobi', 'pps', 'ppsx'] },
  { id: 'music', exts: ['mp3', 'wav', 'wma', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'ra', 'mid', 'midi'] },
  { id: 'programs', exts: ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'apk', 'bat', 'cmd', 'jar', 'dmg', 'deb', 'rpm'] },
  { id: 'video', exts: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'm2ts', 'ogv', 'rm', 'rmvb', 'vob', 'asf'] },
];

const GENERAL = 'general';
const defaultCategories = () => BUILTIN.map((c) => ({ id: c.id, name: '', exts: [...c.exts], dir: '', sites: [] }));

// Uzantı listesi metni → dizi ("zip rar, .7z" → ['zip','rar','7z'])
const parseExts = (s) => [...new Set(String(s || '').toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^\*?\./, '')).filter((x) => /^[a-z0-9]{1,12}$/.test(x)))];

// Önce site kuralı (kullanıcı kategorilerinde), sonra uzantı. Bulunamazsa 'general'.
function categorize(fileName, categories, url = '') {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* adres yok */ }
  if (host) {
    for (const c of categories) {
      if ((c.sites || []).some((s) => host === s || host.endsWith(`.${s}`))) return c.id;
    }
  }
  const ext = extOf(fileName);
  if (!ext) return GENERAL;
  const hit = categories.find((c) => (c.exts || []).includes(ext));
  return hit ? hit.id : GENERAL;
}

// Kategorinin klasörü. baseDir: ana indirme klasörü; label(id): yerleşik kategorinin görünen adı
function dirFor(categoryId, categories, baseDir, label = (id) => id) {
  const c = categories.find((x) => x.id === categoryId);
  if (c && c.dir) return c.dir;
  if (!c || categoryId === GENERAL) return baseDir;
  return path.join(baseDir, c.name || label(c.id));
}

module.exports = { BUILTIN, GENERAL, defaultCategories, parseExts, categorize, dirFor };
