'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { content, sha } = require('./server');
const { startFtpServer } = require('./ftp-server');
const { tmpDir, fileSha } = require('./helpers');
const { DownloadTask } = require('../src/engine/task');
const { createFtpTransport, parseFtpUrl, mdtmToDate } = require('../src/engine/transport-ftp');

const BIG = content(2 * 1024 * 1024 + 77, 11);
const MID = content(700 * 1024, 13);

let srv;
test.before(async () => { srv = await startFtpServer({ files: { 'pub/big.bin': BIG, 'pub/mid.bin': MID, 'a b.bin': MID } }); });
test.after(() => srv.close());

function makeTask(url, extra = {}) {
  const dir = tmpDir();
  const task = new DownloadTask({
    id: extra.id || 'f1', transport: createFtpTransport({ url, ...(extra.ftp || {}) }), tempDir: path.join(dir, 'tmp'),
    chooseDest: async ({ fileName }) => path.join(dir, 'out', fileName), minSegment: 16 * 1024, retryDelay: () => 20, progressMs: 50, ...extra,
  });
  return { task, dir };
}

test('FTP adres ayrıştırma ve MDTM', () => {
  assert.deepStrictEqual(parseFtpUrl('ftp://ali:p%40ss@h.example:2121/d/%C3%B6.zip'), { host: 'h.example', port: 2121, path: 'd/ö.zip', user: 'ali', pass: 'p@ss' });
  const anon = parseFtpUrl('ftp://h/x.bin');
  assert.strictEqual(anon.user, 'anonymous');
  assert.strictEqual(anon.port, 21);
  assert.strictEqual(parseFtpUrl('ftp://h/x.bin', { user: 'k', pass: 's' }).user, 'k');
  assert.strictEqual(mdtmToDate('20240102030405'), 'Tue, 02 Jan 2024 03:04:05 GMT');
});

test('FTP yoklama: boyut, REST desteği, son değişiklik', async () => {
  const t = createFtpTransport({ url: `ftp://u:p@127.0.0.1:${srv.port}/pub/mid.bin` });
  const info = await t.probe();
  assert.strictEqual(info.size, MID.length);
  assert.strictEqual(info.resumable, true);
  assert.strictEqual(info.first, null);
  assert.strictEqual(info.lastModified, 'Tue, 02 Jan 2024 03:04:05 GMT');
});

test('FTP çok bağlantılı indirme: içerik birebir aynı, her bölüm REST ile', async () => {
  const before = srv.stats.retr.length;
  const { task } = makeTask(`ftp://u:p@127.0.0.1:${srv.port}/pub/big.bin`, { connections: 4 });
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(fileSha(task.dest), sha(BIG));
  assert.strictEqual(path.basename(task.dest), 'big.bin');
  const rests = srv.stats.retr.slice(before);
  assert.ok(rests.length >= 4, `RETR sayısı ${rests.length}`);
  assert.ok(rests.filter((r) => r > 0).length >= 3, 'bölümler REST konumundan başladı');
  assert.ok(!fs.existsSync(task.tempDir));
});

test('FTP anonim giriş, PASV yedeği ve boşluklu dosya adı', async () => {
  srv.set({ noEpsv: true });
  try {
    const { task } = makeTask(`ftp://127.0.0.1:${srv.port}/a%20b.bin`, { id: 'anon', connections: 2 });
    await task.start();
    assert.strictEqual(task.status, 'completed', task.error && task.error.message);
    assert.strictEqual(fileSha(task.dest), sha(MID));
    assert.strictEqual(path.basename(task.dest), 'a b.bin');
  } finally {
    srv.set({ noEpsv: false });
  }
});

test('FTP duraklat ve sürdür: yeni görev REST ile kaldığı yerden', async () => {
  srv.set({ bps: 150000 });
  const url = `ftp://u:p@127.0.0.1:${srv.port}/pub/mid.bin`;
  const dir = tmpDir();
  const opts = { id: 'fpr', tempDir: path.join(dir, 'tmp'), chooseDest: async ({ fileName }) => path.join(dir, fileName), minSegment: 16 * 1024, connections: 3, progressMs: 50 };
  try {
    const t1 = new DownloadTask({ ...opts, transport: createFtpTransport({ url }) });
    const p = t1.start();
    await new Promise((r) => setTimeout(r, 500));
    const abortsBefore = srv.stats.aborts;
    await t1.pause();
    await p;
    assert.strictEqual(t1.status, 'paused');
    const got = t1.received;
    assert.ok(got > 0 && got < MID.length, `yarım: ${got}`);
    // Akış kapatılınca kontrol bağlantısı ABOR gönderir
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(srv.stats.aborts > abortsBefore, 'ABOR gönderildi');
    srv.set({ bps: 0 });
    const before = srv.stats.retr.length;
    const t2 = new DownloadTask({ ...opts, transport: createFtpTransport({ url }) });
    await t2.start();
    assert.strictEqual(t2.status, 'completed', t2.error && t2.error.message);
    assert.strictEqual(fileSha(path.join(dir, 'mid.bin')), sha(MID));
    const rests = srv.stats.retr.slice(before);
    assert.ok(rests.length > 0 && rests.every((r) => r > 0), `sürdürmede REST konumları: ${rests}`);
  } finally {
    srv.set({ bps: 0 });
  }
});

test('FTP kimlik hatası (530) yeniden denenmez; olmayan dosya (550) not_found', async () => {
  const { task } = makeTask(`ftp://u:yanlis@127.0.0.1:${srv.port}/pub/mid.bin`, { id: 'bad' });
  let retries = 0;
  task.on('retry', () => retries++);
  task.on('error', () => {});
  await task.start();
  assert.strictEqual(task.status, 'error');
  assert.strictEqual(task.error.code, 'auth_required');
  assert.strictEqual(task.error.transient, false);
  assert.strictEqual(retries, 0);

  const nf = makeTask(`ftp://u:p@127.0.0.1:${srv.port}/pub/yok.bin`, { id: 'nf' });
  nf.task.on('error', () => {});
  await nf.task.start();
  assert.strictEqual(nf.task.status, 'error');
  assert.strictEqual(nf.task.error.code, 'not_found');
});

test('FTP REST desteklemeyen sunucu: tek bağlantı, resumable=false', async () => {
  srv.set({ noRest: true });
  try {
    const { task } = makeTask(`ftp://u:p@127.0.0.1:${srv.port}/pub/mid.bin`, { id: 'nrest', connections: 4 });
    const resolved = [];
    task.on('resolved', (r) => resolved.push(r));
    await task.start();
    assert.strictEqual(task.status, 'completed', task.error && task.error.message);
    assert.strictEqual(resolved[0].resumable, false);
    assert.strictEqual(task.segments.length, 1);
    assert.strictEqual(fileSha(task.dest), sha(MID));
  } finally {
    srv.set({ noRest: false });
  }
});
