'use strict';

// Eklenti simgelerini (16/32/48/128 PNG) saf Node ile üretir: zlib + elle PNG kodlama, harici bağımlılık yok.
// Marka: koyu yuvarlak kare üzerinde camgöbeği #22d3ee → çivit #6366f1 dikey degrade aşağı ok (+ taban çizgisi).
// Kullanım: node extension/make-icons.js [çıktı klasörü]  (varsayılan extension/src/icons)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];

// ---- PNG kodlama ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // süzgeç yok
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- şekiller (birim kare koordinatları, 0..1) ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_TOP = hex('#1e293b');
const BG_BOT = hex('#0b1120');
const C1 = hex('#22d3ee');
const C2 = hex('#6366f1');
const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inTri(x, y, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([x, y], a, b); const d2 = s([x, y], b, c); const d3 = s([x, y], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function inArrow(x, y) {
  if (inRoundRect(x, y, 0.415, 0.18, 0.585, 0.56, 0.04)) return true;      // gövde
  if (inTri(x, y, [0.22, 0.47], [0.78, 0.47], [0.5, 0.76])) return true;   // uç
  return inRoundRect(x, y, 0.24, 0.80, 0.76, 0.865, 0.03);                // taban çizgisi
}

// Bir pikselin rengi: alt örnekleme ile kenar yumuşatma
function renderIcon(size) {
  const ss = size <= 32 ? 8 : 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          let col = null;
          if (inArrow(x, y)) col = lerp(C1, C2, Math.min(1, Math.max(0, (y - 0.18) / 0.685)));
          else if (inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)) col = lerp(BG_TOP, BG_BOT, y);
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      if (a) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); }
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, size, buf);
}

function writeIcons(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return SIZES.map((s) => {
    const p = path.join(dir, `icon-${s}.png`);
    fs.writeFileSync(p, renderIcon(s));
    return p;
  });
}

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, 'src', 'icons');
  for (const p of writeIcons(dir)) console.log(p);
}

module.exports = { SIZES, renderIcon, writeIcons, encodePng };
