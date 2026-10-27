'use strict';

// Dosya adı: Content-Disposition (RFC 6266 / 5987), adres yolu, MIME türü; Windows için temizlik ve yinelenen ad.

const fs = require('fs');
const path = require('path');

const MIME_EXT = {
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'application/x-rar-compressed': 'rar', 'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z', 'application/gzip': 'gz', 'application/x-tar': 'tar', 'application/pdf': 'pdf',
  'application/x-msdownload': 'exe', 'application/x-msi': 'msi', 'application/x-iso9660-image': 'iso',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv', 'application/json': 'json',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/aac': 'aac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
  'video/mp2t': 'ts', 'video/x-flv': 'flv',
};

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function sanitize(name, fallback = 'download') {
  let s = String(name || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*\u007f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s || s === '.' || s === '..') s = fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  // NTFS ad sınırı 255; uzantıyı koruyarak kısalt
  if (s.length > 200) {
    const ext = path.extname(s).slice(0, 16);
    s = s.slice(0, 200 - ext.length) + ext;
  }
  return s;
}

function decodeRfc5987(v) {
  const m = /^([\w!#$%&+^`{}~-]*)'[\w-]*'(.*)$/.exec(v);
  if (!m) return null;
  try {
    const bytes = Buffer.from(unescape(m[2]), 'latin1');
    return /utf-?8/i.test(m[1]) || !m[1] ? bytes.toString('utf8') : bytes.toString('latin1');
  } catch {
    return null;
  }
}

function fromContentDisposition(h) {
  if (!h) return null;
  const star = /filename\*\s*=\s*("?)([^";]+)\1/i.exec(h);
  if (star) {
    const v = decodeRfc5987(star[2].trim());
    if (v) return v;
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(h);
  if (plain) {
    let v = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2].trim();
    // Bazı sunucular UTF-8 baytlarını latin1 başlıkta gönderir
    const asUtf8 = Buffer.from(v, 'latin1').toString('utf8');
    if (!asUtf8.includes('�') && asUtf8 !== v) v = asUtf8;
    return v;
  }
  return null;
}

function fromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

// headers: yanıt başlıkları (küçük harf). Uzantı yoksa MIME'dan eklenir.
function chooseName({ url, headers = {}, suggested = '' }) {
  let name = suggested || fromContentDisposition(headers['content-disposition']) || fromUrl(url);
  const mime = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!path.extname(name) && MIME_EXT[mime] && mime !== 'text/html') name = `${name || 'download'}.${MIME_EXT[mime]}`;
  if (!name && mime === 'text/html') name = 'index.html';
  return sanitize(name);
}

// Klasörde aynı ad varsa "ad (2).ext", "ad (3).ext"… (rezerve edilmiş adlar da dolu sayılır)
function uniquePath(dir, name, taken = () => false) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p) || taken(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();

module.exports = { sanitize, fromContentDisposition, fromUrl, chooseName, uniquePath, extOf, MIME_EXT };
