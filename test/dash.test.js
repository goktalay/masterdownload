'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, content, sha } = require('./server');
const { tmpDir, fileSha } = require('./helpers');
const { MediaTask } = require('../src/engine/media-task');
const { parseXml, parseMpd, parseDuration, listRepresentations, segmentsFor, fillTemplate, extForMime } = require('../src/engine/dash');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.close());

function makeTask(url, extra = {}) {
  const dir = tmpDir();
  const task = new MediaTask({
    id: extra.id || 'd1', url, kind: 'dash', tempDir: path.join(dir, 'tmp'),
    chooseDest: async ({ fileName }) => path.join(dir, 'out', fileName), retryDelay: () => 20, progressMs: 50, ...extra,
  });
  return { task, dir };
}

// Sayı tabanlı SegmentTemplate: <prefix>/<rep>/init.mp4 + <rep>/seg-00001.m4s …
function publishNumber(prefix, reps, { count = 5, segSize = 30 * 1024, extraAs = '', type = 'static' } = {}) {
  const expected = {};
  for (const r of reps) {
    const parts = [content(800, r.seed)];
    srv.setStatic(`${prefix}/${r.id}/init.mp4`, parts[0]);
    for (let i = 1; i <= count; i++) {
      const b = content(segSize + i, r.seed * 100 + i);
      srv.setStatic(`${prefix}/${r.id}/seg-${String(i).padStart(5, '0')}.m4s`, b);
      parts.push(b);
    }
    expected[r.id] = Buffer.concat(parts);
  }
  const set = (kind) => reps.filter((r) => r.kind === kind).map((r) =>
    `      <Representation id="${r.id}" bandwidth="${r.bw}"${r.w ? ` width="${r.w}" height="${r.h}"` : ''} codecs="${r.codecs}"/>`).join('\n');
  const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<!-- deneme -->
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="${type}" mediaPresentationDuration="PT${count * 2}S" minBufferTime="PT2S">
  <Period id="p0">
    <AdaptationSet contentType="video" mimeType="video/mp4" segmentAlignment="true">${extraAs}
      <SegmentTemplate timescale="1000" duration="2000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number%05d$.m4s"/>
${set('video')}
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="tr">
      <SegmentTemplate timescale="1000" duration="2000" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number%05d$.m4s"/>
${set('audio')}
    </AdaptationSet>
  </Period>
</MPD>`;
  srv.setStatic(`${prefix}/manifest.mpd`, mpd, 'application/dash+xml');
  return { mpd, expected };
}

const REPS = [
  { id: 'v360', kind: 'video', bw: 600000, w: 640, h: 360, codecs: 'avc1.4d401e', seed: 11 },
  { id: 'v1080', kind: 'video', bw: 4000000, w: 1920, h: 1080, codecs: 'avc1.640028', seed: 12 },
  { id: 'v720', kind: 'video', bw: 2000000, w: 1280, h: 720, codecs: 'avc1.4d401f', seed: 13 },
  { id: 'a128', kind: 'audio', bw: 128000, codecs: 'mp4a.40.2', seed: 14 },
];

test('XML ayrıştırıcı, ISO süre, şablon doldurma, MIME uzantısı', () => {
  const x = parseXml('<?xml version="1.0"?><!-- y --><a:Root x="1 &amp; 2"><b>metin &lt;3</b><c/><![CDATA[<ham>]]></a:Root>');
  const r = x.children[0];
  assert.strictEqual(r.name, 'Root');
  assert.strictEqual(r.qname, 'a:Root');
  assert.strictEqual(r.attrs.x, '1 & 2');
  assert.strictEqual(r.children[0].text, 'metin <3');
  assert.strictEqual(r.children[1].name, 'c');
  assert.strictEqual(r.text, '<ham>');
  assert.strictEqual(parseDuration('PT1H2M3.5S'), 3723.5);
  assert.strictEqual(parseDuration('P1DT1S'), 86401);
  assert.strictEqual(parseDuration('PT0S'), 0);
  assert.strictEqual(fillTemplate('$RepresentationID$/$Bandwidth$/$Number%04d$-$Time$$$.m4s', { RepresentationID: 'v', Bandwidth: 5, Number: 7, Time: 9000 }), 'v/5/0007-9000$.m4s');
  assert.strictEqual(extForMime('video/mp4'), '.mp4');
  assert.strictEqual(extForMime('audio/mp4'), '.m4a');
  assert.strictEqual(extForMime('video/webm'), '.webm');
  assert.strictEqual(extForMime('audio/webm'), '.webm');
});

test('MPD: temsiller, BaseURL zinciri, SegmentTimeline ($Time$, r, r=-1), SegmentList, SegmentBase', () => {
  const mpd = parseMpd(`<MPD type="static" mediaPresentationDuration="PT20S">
  <BaseURL>https://cdn.example/v/</BaseURL>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <BaseURL>video/</BaseURL>
      <SegmentTemplate timescale="90000" initialization="$RepresentationID$_init.mp4" media="$RepresentationID$_$Time$.m4s">
        <SegmentTimeline><S t="0" d="360000" r="2"/><S d="180000"/><S d="90000" r="-1"/></SegmentTimeline>
      </SegmentTemplate>
      <Representation id="hd" bandwidth="3000000" width="1280" height="720" codecs="avc1.64001f"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <Representation id="aud" bandwidth="96000" codecs="mp4a.40.2">
        <BaseURL>https://other.example/a/</BaseURL>
        <SegmentList timescale="1000" duration="10000">
          <Initialization sourceURL="init.m4a" range="0-599"/>
          <SegmentURL media="s1.m4a"/>
          <SegmentURL mediaRange="600-1999"/>
        </SegmentList>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="text/vtt"><Representation id="sub" bandwidth="1"/></AdaptationSet>
    <AdaptationSet mimeType="video/webm">
      <Representation id="single" bandwidth="500000"><BaseURL>tek.webm</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation>
    </AdaptationSet>
  </Period>
</MPD>`, 'http://h.example/m/manifest.mpd');
  assert.strictEqual(mpd.duration, 20);
  const reps = listRepresentations(mpd);
  assert.deepStrictEqual(reps.map((r) => r.id), ['hd', 'aud', 'single'], 'altyazı listelenmez');
  assert.deepStrictEqual({ ...reps[0] }, { id: 'hd', kind: 'video', bandwidth: 3000000, width: 1280, height: 720, codecs: 'avc1.64001f', mime: 'video/mp4' });
  assert.strictEqual(reps[1].kind, 'audio');

  const v = segmentsFor(reps[0]);
  assert.deepStrictEqual(v.init, { url: 'https://cdn.example/v/video/hd_init.mp4' });
  // 3×4 sn + 2 sn + kalan (20-14=6 sn) 1'er sn = 10 parça
  assert.strictEqual(v.segments.length, 3 + 1 + 6);
  assert.strictEqual(v.segments[0].url, 'https://cdn.example/v/video/hd_0.m4s');
  assert.strictEqual(v.segments[3].url, 'https://cdn.example/v/video/hd_1080000.m4s');
  assert.strictEqual(v.segments[4].url, 'https://cdn.example/v/video/hd_1260000.m4s');
  assert.strictEqual(v.segments[9].url, 'https://cdn.example/v/video/hd_1710000.m4s');
  assert.strictEqual(v.segments[3].duration, 2);

  const a = segmentsFor(reps[1]);
  assert.deepStrictEqual(a.init, { url: 'https://other.example/a/init.m4a', byterange: { offset: 0, length: 600 } });
  assert.deepStrictEqual(a.segments, [
    { url: 'https://other.example/a/s1.m4a', duration: 10 },
    { url: 'https://other.example/a/', byterange: { offset: 600, length: 1400 }, duration: 10 },
  ]);

  const s = segmentsFor(reps[2]);
  assert.strictEqual(s.init, null);
  assert.deepStrictEqual(s.segments.map((x) => x.url), ['https://cdn.example/v/tek.webm']);
});

test('MPD: ContentProtection → encrypted_stream, type="dynamic" → live_stream', () => {
  const prot = `<MPD type="static" mediaPresentationDuration="PT4S"><Period><AdaptationSet mimeType="video/mp4">
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>
    <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>AAAA</cenc:pssh></ContentProtection>
    <Representation id="v" bandwidth="1"/></AdaptationSet></Period></MPD>`;
  assert.throws(() => parseMpd(prot, 'http://h/'), { code: 'encrypted_stream' });
  assert.strictEqual(parseMpd(prot, 'http://h/', { strict: false }).encrypted, true);
  assert.throws(() => parseMpd('<MPD type="dynamic"><Period/></MPD>', 'http://h/'), { code: 'live_stream' });
  assert.throws(() => parseMpd('<html></html>', 'http://h/'), { code: 'bad_manifest' });
});

test('DASH indirme: en yüksek bant genişlikli görüntü, init + parçalar → .mp4; ses temsili → .m4a', async () => {
  const { expected } = publishNumber('/d1', REPS);
  const url = `${srv.base}/static/d1/manifest.mpd`;
  const { task } = makeTask(url, { connections: 4 });
  const resolved = [];
  task.on('resolved', (r) => resolved.push(r));
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(resolved[0].variant.id, 'v1080');
  assert.strictEqual(resolved[0].segmentsTotal, 6);
  assert.strictEqual(path.basename(task.dest), 'd1.mp4');
  assert.strictEqual(fileSha(task.dest), sha(expected.v1080));
  assert.ok(!srv.stats.byPath['/static/d1/v360/init.mp4'], 'başka temsil indirilmedi');
  assert.ok(!fs.existsSync(task.tempDir));

  const au = makeTask(url, { id: 'au', variant: 'a128' });
  await au.task.start();
  assert.strictEqual(au.task.status, 'completed', au.task.error && au.task.error.message);
  assert.strictEqual(path.basename(au.task.dest), 'd1.m4a');
  assert.strictEqual(fileSha(au.task.dest), sha(expected.a128));

  const bad = makeTask(url, { id: 'bad', variant: 'yok' });
  bad.task.on('error', () => {});
  await bad.task.start();
  assert.strictEqual(bad.task.error.code, 'variant_not_found');
});

test('DASH yalnız ses: görüntü yoksa ses temsili seçilir', async () => {
  const { expected } = publishNumber('/d2', [REPS[3]]);
  const { task } = makeTask(`${srv.base}/static/d2/manifest.mpd`, { id: 'ao' });
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(path.basename(task.dest), 'd2.m4a');
  assert.strictEqual(fileSha(task.dest), sha(expected.a128));
});

test('DASH SegmentTimeline ($Time$) ve SegmentBase (tek dosya) indirme', async () => {
  const parts = [content(500, 1)];
  srv.setStatic('/tl/i.mp4', parts[0]);
  let t = 0;
  for (const d of [4000, 4000, 4000, 2000]) {
    const b = content(20000 + t / 100, t + 3);
    srv.setStatic(`/tl/c-${t}.m4s`, b);
    parts.push(b);
    t += d;
  }
  srv.setStatic('/tl/manifest.mpd', `<MPD type="static" mediaPresentationDuration="PT14S"><Period>
    <AdaptationSet mimeType="video/mp4"><Representation id="r" bandwidth="1000" width="10" height="10">
      <SegmentTemplate timescale="1000" initialization="i.mp4" media="c-$Time$.m4s"><SegmentTimeline><S t="0" d="4000" r="2"/><S d="2000"/></SegmentTimeline></SegmentTemplate>
    </Representation></AdaptationSet></Period></MPD>`);
  const { task } = makeTask(`${srv.base}/static/tl/manifest.mpd`, { id: 'tl', fileName: 'zaman' });
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(path.basename(task.dest), 'zaman.mp4');
  assert.strictEqual(fileSha(task.dest), sha(Buffer.concat(parts)));

  const size = 120000;
  srv.setStatic('/sb/manifest.mpd', `<MPD type="static" mediaPresentationDuration="PT10S"><Period>
    <AdaptationSet mimeType="video/webm"><Representation id="w" bandwidth="1"><BaseURL>/file/tek.webm?size=${size}</BaseURL>
    <SegmentBase indexRange="10-20"/></Representation></AdaptationSet></Period></MPD>`);
  const sb = makeTask(`${srv.base}/static/sb/manifest.mpd`, { id: 'sb' });
  await sb.task.start();
  assert.strictEqual(sb.task.status, 'completed', sb.task.error && sb.task.error.message);
  assert.strictEqual(path.basename(sb.task.dest), 'sb.webm');
  assert.strictEqual(fileSha(sb.task.dest), sha(srv.body(size)));
});

test('DASH korumalı ve canlı MPD görevde reddedilir', async () => {
  publishNumber('/drm', [REPS[0]], { extraAs: '\n      <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>' });
  publishNumber('/lv', [REPS[0]], { type: 'dynamic' });
  for (const [p, code] of [['/static/drm/manifest.mpd', 'encrypted_stream'], ['/static/lv/manifest.mpd', 'live_stream']]) {
    const { task } = makeTask(`${srv.base}${p}`, { id: 'r' });
    let retries = 0;
    task.on('retry', () => retries++);
    task.on('error', () => {});
    await task.start();
    assert.strictEqual(task.status, 'error');
    assert.strictEqual(task.error.code, code);
    assert.strictEqual(retries, 0);
  }
  assert.ok(!srv.stats.byPath['/static/drm/v360/init.mp4']);
});

test('DASH duraklat ve sürdür', async () => {
  const { expected } = publishNumber('/dpr', [REPS[2]], { count: 10, segSize: 50 * 1024 });
  const dir = tmpDir();
  const opts = { id: 'dpr', url: `${srv.base}/static/dpr/manifest.mpd`, kind: 'dash', tempDir: path.join(dir, 'tmp'), chooseDest: async ({ fileName }) => path.join(dir, fileName), connections: 2, progressMs: 50 };
  const t1 = new MediaTask({ ...opts, speedLimit: 200 * 1024 });
  const p = t1.start();
  await new Promise((r) => setTimeout(r, 800));
  await t1.pause();
  await p;
  assert.strictEqual(t1.status, 'paused');
  const doneBefore = t1.segmentsDone;
  assert.ok(doneBefore > 0 && doneBefore < 11, `yarım: ${doneBefore}`);
  const initCount = srv.stats.byPath['/static/dpr/v720/init.mp4'];
  const t2 = new MediaTask(opts);
  await t2.start();
  assert.strictEqual(t2.status, 'completed', t2.error && t2.error.message);
  assert.strictEqual(srv.stats.byPath['/static/dpr/v720/init.mp4'], initCount, 'init yeniden indirilmedi');
  assert.strictEqual(fileSha(path.join(dir, 'dpr.mp4')), sha(expected.v720));
});
