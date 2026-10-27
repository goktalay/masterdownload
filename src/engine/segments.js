'use strict';

// Dinamik bölümleme (IDM'deki gibi). Saf mantık; dosya ve ağ yoktur.
//
// Bölüm: { id, start, end, pos } — end dahil; pos yazılacak sıradaki bayt (start ≤ pos ≤ end + 1).
// Başta dosya N eşit bölüme ayrılır. Bir bağlantı bölümünü bitirince kalan en büyük bölümün kalan kısmı
// ikiye bölünür: eski bağlantı ilk yarıda devam eder (end küçülür), boşalan bağlantı ikinci yarıyı alır.

const MIN_SEGMENT = 256 * 1024;

const remaining = (s) => Math.max(0, s.end - s.pos + 1);
const isDone = (s) => s.pos > s.end;

function initialPlan(size, connections, minSegment = MIN_SEGMENT) {
  if (!(size > 0)) return [{ id: 0, start: 0, end: Infinity, pos: 0 }];
  const n = Math.max(1, Math.min(connections, Math.floor(size / minSegment) || 1));
  const step = Math.ceil(size / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = i * step;
    if (start >= size) break;
    out.push({ id: i, start, end: Math.min(size - 1, start + step - 1), pos: start });
  }
  return out;
}

// Etkin (bağlantısı olan) bölümler arasından kalanı en büyük olanı böler. Dönen: yeni bölüm ya da null.
// busy(id) → o bölümün bir bağlantısı var mı. Bağlantısız yarım bölüm varsa önce o verilir (bölmeye gerek yok).
function nextSegment(segments, busy, minSegment = MIN_SEGMENT) {
  const idle = segments.find((s) => !isDone(s) && !busy(s.id));
  if (idle) return idle;
  let best = null;
  for (const s of segments) {
    if (isDone(s) || !busy(s.id) || s.end === Infinity) continue;
    if (!best || remaining(s) > remaining(best)) best = s;
  }
  if (!best || remaining(best) < 2 * minSegment) return null;
  const mid = best.pos + Math.floor(remaining(best) / 2);
  const id = segments.reduce((m, s) => Math.max(m, s.id), -1) + 1;
  const seg = { id, start: mid, end: best.end, pos: mid };
  best.end = mid - 1;
  segments.push(seg);
  segments.sort((a, b) => a.start - b.start);
  return seg;
}

const totalReceived = (segments) => segments.reduce((n, s) => n + (s.pos - s.start), 0);
const allDone = (segments) => segments.every(isDone);

// Bölümler dosyanın tamamını boşluksuz ve çakışmasız kaplıyor mu (birleştirmeden önce denetlenir)
function covers(segments, size) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let next = 0;
  for (const s of sorted) {
    if (s.start !== next) return false;
    next = s.end + 1;
  }
  return next === size;
}

module.exports = { MIN_SEGMENT, initialPlan, nextSegment, remaining, isDone, totalReceived, allDone, covers };
