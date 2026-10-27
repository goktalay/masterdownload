'use strict';

// Saf modüller: bölümleme, dosya adı, kategoriler, toplu kalıp, .ef2, komut satırı, kuyruk/zamanlayıcı, hız kovası

const test = require('node:test');
const assert = require('node:assert');
const { initialPlan, nextSegment, covers } = require('../src/engine/segments');
const { sanitize, fromContentDisposition, chooseName } = require('../src/engine/filename');
const { defaultCategories, categorize, dirFor, parseExts } = require('../src/engine/categories');
const { expandPattern, extractLinks, isDownloadLink } = require('../src/engine/batch');
const { parseEf2, formatEf2 } = require('../src/engine/ef2');
const { parseArgs } = require('../src/cli');
const { scheduleAction, nextStart, pickToStart, createQueueRunner, defaultQueues } = require('../src/engine/queue');
const { createBucket } = require('../src/engine/throttle');
const path = require('path');

test('bölümleme: eşit plan, en büyük kalanı ikiye bölme, kaplama', () => {
  const segs = initialPlan(1000, 4, 10);
  assert.deepStrictEqual(segs.map((s) => [s.start, s.end]), [[0, 249], [250, 499], [500, 749], [750, 999]]);
  const busy = new Set([0, 1, 2, 3]);
  segs[0].pos = 250; busy.delete(0); // 0 bitti
  segs[1].pos = 300; segs[2].pos = 520; segs[3].pos = 990;
  const n = nextSegment(segs, (id) => busy.has(id), 10);
  // en büyük kalan: 2 (520–749 → 230 bayt) → 635'ten bölünür
  assert.strictEqual(n.start, 520 + 115);
  assert.strictEqual(n.end, 749);
  assert.strictEqual(segs.find((s) => s.id === 2).end, 634);
  assert.ok(covers(segs, 1000));
  // küçük kalanlar bölünmez
  assert.strictEqual(nextSegment([{ id: 0, start: 0, end: 15, pos: 0 }], () => true, 10), null);
  // boyutu bilinmeyen dosya tek bölüm
  assert.strictEqual(initialPlan(null, 8)[0].end, Infinity);
});

test('dosya adı: Content-Disposition, temizleme, MIME uzantısı', () => {
  assert.strictEqual(fromContentDisposition("attachment; filename*=UTF-8''%C3%A7%C4%B1kt%C4%B1.pdf"), 'çıktı.pdf');
  assert.strictEqual(fromContentDisposition('attachment; filename="a \\"b\\".zip"'), 'a "b".zip');
  assert.strictEqual(sanitize('a<b>:c?.txt'), 'a_b__c_.txt');
  assert.strictEqual(sanitize('CON.txt'), '_CON.txt');
  assert.strictEqual(sanitize('ad. '), 'ad');
  assert.strictEqual(chooseName({ url: 'http://x/indir', headers: { 'content-type': 'application/pdf' } }), 'indir.pdf');
  assert.strictEqual(chooseName({ url: 'http://x/a%20b.zip?x=1' }), 'a b.zip');
});

test('kategoriler: uzantı ve site kuralı, klasör', () => {
  const cats = defaultCategories();
  assert.strictEqual(categorize('film.MKV', cats), 'video');
  assert.strictEqual(categorize('arsiv.7z', cats), 'compressed');
  assert.strictEqual(categorize('kurulum.msi', cats), 'programs');
  assert.strictEqual(categorize('bilinmeyen.xyz', cats), 'general');
  cats.push({ id: 'u1', name: 'İşler', exts: [], dir: '', sites: ['example.com'] });
  assert.strictEqual(categorize('a.zip', cats, 'https://dl.example.com/a.zip'), 'u1');
  assert.strictEqual(dirFor('video', cats, path.join('D', 'In'), () => 'Video'), path.join('D', 'In', 'Video'));
  assert.strictEqual(dirFor('general', cats, 'D'), 'D');
  assert.deepStrictEqual(parseExts('ZIP, .rar *.7z  zip'), ['zip', 'rar', '7z']);
});

test('toplu kalıp ve bağlantı ayıklama', () => {
  assert.deepStrictEqual(expandPattern('http://x/f*.zip', { from: 8, to: 11, width: 3 }), ['http://x/f008.zip', 'http://x/f009.zip', 'http://x/f010.zip', 'http://x/f011.zip']);
  assert.deepStrictEqual(expandPattern('http://x/[a-c].bin'), ['http://x/a.bin', 'http://x/b.bin', 'http://x/c.bin']);
  assert.deepStrictEqual(expandPattern('http://x/[01-03]/[1-2].jpg').length, 6);
  assert.deepStrictEqual(expandPattern('http://x/[0-10:5].jpg'), ['http://x/0.jpg', 'http://x/5.jpg', 'http://x/10.jpg']);
  assert.deepStrictEqual(extractLinks('bak: https://a.com/x.zip, ve (http://b.org/y?z=1&amp;w=2). https://a.com/x.zip'),
    ['https://a.com/x.zip', 'http://b.org/y?z=1&w=2']);
  assert.strictEqual(isDownloadLink(' https://a.com/f.ZIP ', ['zip']), true);
  assert.strictEqual(isDownloadLink('https://a.com/sayfa', ['zip']), false);
});

test('.ef2 gidiş-dönüş ve hoşgörülü ayrıştırma', () => {
  const items = [{ url: 'https://a.com/x.zip', referrer: 'https://a.com/', ua: 'UA/1', cookies: 's=1' }, { url: 'ftp://b.org/y.iso' }];
  const text = formatEf2(items);
  assert.ok(text.includes('\r\n'));
  assert.ok(!text.includes('cookie'), 'çerez varsayılan olarak yazılmaz');
  const back = parseEf2(text);
  assert.deepStrictEqual(back, [{ url: 'https://a.com/x.zip', referrer: 'https://a.com/', ua: 'UA/1' }, { url: 'ftp://b.org/y.iso' }]);
  assert.deepStrictEqual(parseEf2('\uFEFF<\nhttps://c.com/z\nREFERER: r\nbilinmeyen: q\n'), [{ url: 'https://c.com/z', referrer: 'r' }]);
});

test('komut satırı: IDM parametreleri', () => {
  const o = parseArgs(['/d', 'https://a.com/f.zip', '/p', 'C:\\İndir', '/f', 'g.zip', '/n', '/q', '/a']);
  assert.deepStrictEqual([o.url, o.dir, o.fileName, o.silent, o.quit, o.addOnly], ['https://a.com/f.zip', 'C:\\İndir', 'g.zip', true, true, true]);
  assert.strictEqual(parseArgs(['/s']).startQueue, true);
  assert.strictEqual(parseArgs(['/d', 'javascript:alert(1)']).url, null);
  assert.deepStrictEqual(parseArgs(['C:\\liste.ef2']).files, ['C:\\liste.ef2']);
});

test('zamanlayıcı: saat, gün, tek seferlik', () => {
  const q = { id: 'main', schedule: { enabled: true, start: '02:00', stop: '07:30', days: [1, 3] } };
  const mon2 = new Date(2026, 9, 26, 2, 0); // 26 Ekim 2026 Pazartesi
  assert.strictEqual(scheduleAction(q, mon2, {}), 'start');
  assert.strictEqual(scheduleAction(q, mon2, { start: '2026-10-26' }), null, 'aynı gün iki kez değil');
  assert.strictEqual(scheduleAction(q, new Date(2026, 9, 27, 2, 0), {}), null, 'Salı seçili değil');
  assert.strictEqual(scheduleAction(q, new Date(2026, 9, 26, 7, 30), {}), 'stop');
  assert.strictEqual(nextStart(q, new Date(2026, 9, 26, 3, 0)).getDate(), 28); // Çarşamba
  assert.strictEqual(scheduleAction({ schedule: { enabled: false, start: '02:00' } }, mon2), null);
});

test('kuyruk: eşzamanlı sınır, sıra, bitince eylem, zamanlayıcıyla başlama', () => {
  const queues = defaultQueues();
  queues[0].maxParallel = 2;
  queues[0].after = 'shutdown';
  queues[0].schedule = { enabled: true, start: '01:00', stop: '', days: [], once: true };
  const dl = [1, 2, 3, 4].map((i) => ({ id: `d${i}`, queue: 'main', order: 5 - i, status: 'queued' }));
  dl.push({ id: 'x', queue: null, status: 'queued' });
  assert.deepStrictEqual(pickToStart(dl, queues, new Set(['main'])), ['d4', 'd3']);
  let clock = new Date(2026, 9, 27, 0, 59);
  const done = [];
  const runner = createQueueRunner({
    getDownloads: () => dl, getQueues: () => queues, now: () => clock,
    start: (id) => { dl.find((d) => d.id === id).status = 'downloading'; },
    stop: (id) => { dl.find((d) => d.id === id).status = 'paused'; },
    onQueueDone: (q) => done.push(q.after),
  });
  runner.tick();
  assert.strictEqual(runner.isRunning('main'), false);
  clock = new Date(2026, 9, 27, 1, 0);
  runner.tick();
  assert.strictEqual(runner.isRunning('main'), true);
  assert.strictEqual(queues[0].schedule.enabled, false, 'tek seferlik zamanlama kapanır');
  assert.strictEqual(dl.filter((d) => d.status === 'downloading').length, 2);
  for (const d of dl) if (d.status === 'downloading') d.status = 'completed';
  runner.pump();
  assert.strictEqual(dl.filter((d) => d.status === 'downloading').length, 2);
  for (const d of dl) if (d.status === 'downloading') d.status = 'completed';
  runner.pump();
  assert.deepStrictEqual(done, ['shutdown']);
  assert.strictEqual(runner.isRunning('main'), false);
  assert.strictEqual(dl.find((d) => d.id === 'x').status, 'queued', 'kuyruk dışı indirmeye dokunulmaz');
});

test('hız kovası: sahte saatle oran', async () => {
  let t = 0;
  const timers = [];
  const b = createBucket(1000, { now: () => t, setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return 0; } });
  let got = 0;
  b.take(2000).then(() => { got = t; });
  // saati ilerlet, zamanlayıcıları çalıştır
  for (let i = 0; i < 100 && !got; i++) {
    const next = timers.shift();
    if (!next) break;
    t = next.at;
    next.fn();
    await Promise.resolve();
  }
  await new Promise((r) => setImmediate(r));
  assert.ok(got >= 1700 && got <= 2300, `2000 bayt / 1000 B/sn ≈ 2 sn, ölçülen ${got} ms`);
});
