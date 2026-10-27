'use strict';

// IDM .ef2 dışa aktarma biçimi ve düz metin liste.
// .ef2: UTF-8 metin, CRLF. Her kayıt "<" satırıyla açılır, ilk satır adres, ardından "anahtar: değer" satırları,
// ">" satırıyla kapanır. Bilinen anahtarlar: referer, User-Agent, cookie, postdata, username, password, filename,
// filepath (doğrulanabilen: adres, referer, User-Agent — bkz. docs/idm-ozellikleri.md §2.12). Ayrıştırıcı hoşgörülüdür:
// bilinmeyen anahtarlar yok sayılır, büyük/küçük harf önemsizdir, LF satır sonu da kabul edilir.

const KEYMAP = { referer: 'referrer', 'user-agent': 'ua', cookie: 'cookies', username: 'user', password: 'pass', filename: 'fileName', filepath: 'dir', postdata: 'postData' };

function parseEf2(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '<') { cur = {}; continue; }
    if (line === '>') {
      if (cur && cur.url) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur || !line) continue;
    if (!cur.url) {
      if (/^(https?|ftp):\/\//i.test(line)) cur.url = line;
      continue;
    }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = KEYMAP[line.slice(0, i).trim().toLowerCase()];
    if (key) cur[key] = line.slice(i + 1).trim();
  }
  if (cur && cur.url) out.push(cur); // kapanmamış son kayıt
  return out;
}

// items: [{url, referrer, ua, cookies, fileName, dir}]. Çerez ve parola yalnız açıkça istenirse yazılır.
function formatEf2(items, { includeCookies = false } = {}) {
  const lines = [];
  for (const it of items) {
    if (!it || !it.url) continue;
    lines.push('<', it.url);
    if (it.referrer) lines.push(`referer: ${it.referrer}`);
    if (it.ua) lines.push(`User-Agent: ${it.ua}`);
    if (includeCookies && it.cookies) lines.push(`cookie: ${it.cookies}`);
    if (it.fileName) lines.push(`filename: ${it.fileName}`);
    lines.push('>');
  }
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

const formatList = (items) => items.filter((x) => x && x.url).map((x) => x.url).join('\r\n') + (items.length ? '\r\n' : '');

module.exports = { parseEf2, formatEf2, formatList };
