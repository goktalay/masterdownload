'use strict';

// Tek dosya indirmesi: çok bağlantılı, dinamik bölümlü, duraklatılabilir ve kaldığı yerden sürdürülebilir.
//
// Geçici klasör: <tempDir>/<id>/
//   state.json      bölümler ve doğrulayıcılar (1 sn'de bir, geçici dosya + rename ile)
//   <bölüm>.part    her bölümün baytları (start'tan itibaren). pos = start + dosya boyutu
// Bitince bölümler sırayla hedefe birleştirilir (ilk parça yeniden adlandırılır, diğerleri eklenir).
// Windows: her dosya tanıtıcısı kapanması BEKLENEREK kapatılır (await fh.close()), sonra taşınır/silinir.
//
// Olaylar: 'status' (status), 'progress' ({received,size,speed,eta,connections,segments}), 'resolved' ({fileName,size,resumable,dest}),
//          'warning' (code), 'done' ({file,size}), 'error' (err)

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter, setMaxListeners } = require('events');
const { initialPlan, nextSegment, isDone, totalReceived, allDone, covers, MIN_SEGMENT } = require('./segments');
const { takeAll, createBucket } = require('./throttle');
const { chooseName } = require('./filename');

const defaultRetryDelay = (attempt) => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));

class DownloadTask extends EventEmitter {
  constructor(opts) {
    super();
    this.id = String(opts.id);
    this.transport = opts.transport;
    this.tempDir = path.join(opts.tempDir, this.id);
    this.dest = opts.dest || null;           // tam hedef yol; yoksa chooseDest ile belirlenir
    this.chooseDest = opts.chooseDest || null; // async ({fileName,size,mime}) → yol
    this.suggestedName = opts.fileName || '';
    this.connections = Math.max(1, Math.min(32, opts.connections || 8));
    this.minSegment = opts.minSegment || MIN_SEGMENT;
    this.retries = opts.retries ?? 20;
    this.retryDelay = opts.retryDelay || defaultRetryDelay;
    this.globalBuckets = opts.buckets || [];
    this.bucket = createBucket(opts.speedLimit || 0);
    this.progressMs = opts.progressMs || 250;
    this.status = 'idle';
    this.segments = [];
    this.size = null;
    this.resumable = false;
    this.validators = {};
    this.received = 0;
    this.speed = 0;
    this._busy = new Map(); // bölüm id → bağlantı no
    this._ctl = null;
    this._samples = [];
  }

  setSpeedLimit(bps) { this.bucket.setRate(bps || 0); }

  stateFile() { return path.join(this.tempDir, 'state.json'); }
  partFile(seg) { return path.join(this.tempDir, `${seg.id}.part`); }

  async loadState() {
    try {
      const s = JSON.parse(await fsp.readFile(this.stateFile(), 'utf8'));
      if (!s || !Array.isArray(s.segments)) return null;
      for (const seg of s.segments) {
        if (seg.end === null) seg.end = Infinity;
        let have = 0;
        try { have = (await fsp.stat(this.partFile(seg))).size; } catch { /* yok */ }
        const max = seg.end === Infinity ? Infinity : seg.end - seg.start + 1;
        if (have > max) { await fsp.truncate(this.partFile(seg), max); have = max; }
        seg.pos = seg.start + have;
      }
      return s;
    } catch {
      return null;
    }
  }

  async saveState() {
    if (!this.segments.length) return;
    const s = {
      v: 1, size: this.size, resumable: this.resumable, ...this.validators, dest: this.dest,
      segments: this.segments.map((x) => ({ id: x.id, start: x.start, end: x.end === Infinity ? null : x.end })),
    };
    const file = this.stateFile();
    const tmp = `${file}.tmp`;
    await fsp.mkdir(this.tempDir, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(s));
    await fsp.rename(tmp, file);
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  snapshot() {
    return {
      received: this.received, size: this.size, speed: this.speed,
      eta: this.size && this.speed > 0 ? Math.round((this.size - this.received) / this.speed) : null,
      connections: this._busy.size,
      segments: this.segments.map((s) => ({ id: s.id, start: s.start, end: s.end === Infinity ? null : s.end, pos: s.pos, active: this._busy.has(s.id) })),
    };
  }

  _tickProgress() {
    const now = Date.now();
    this.received = totalReceived(this.segments);
    this._samples.push([now, this.received]);
    while (this._samples.length > 2 && now - this._samples[0][0] > 3000) this._samples.shift();
    const [t0, r0] = this._samples[0];
    this.speed = now - t0 > 0 ? Math.max(0, ((this.received - r0) * 1000) / (now - t0)) : 0;
    this.emit('progress', this.snapshot());
  }

  // Başlatır ya da sürdürür. Tamamlanınca / duraklatılınca / hata verince çözülür (hata fırlatmaz; status'a bakın).
  async start() {
    if (this._running) return this._running;
    this._running = this._run().finally(() => { this._running = null; });
    return this._running;
  }

  pause() {
    if (this._ctl) { this._paused = true; this._ctl.abort(); }
    return this._running || Promise.resolve();
  }

  // İndirmeyi bırakır ve geçici dosyaları siler
  async cancel() {
    await this.pause();
    await fsp.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
    this.setStatus('canceled');
  }

  async _run() {
    this._paused = false;
    this._ctl = new AbortController();
    const signal = this._ctl.signal;
    setMaxListeners(200, signal); // her bölüm isteği ve bekleme bir dinleyici ekler
    let timer = null;
    let saver = null;
    try {
      this.setStatus('connecting');
      const saved = await this.loadState();
      const info = await this.transport.probe({ signal });
      let first = info.first || null;
      const fresh = !saved || !this._sameFile(saved, info);
      if (saved && fresh) {
        this.emit('warning', 'changed');
        await fsp.rm(this.tempDir, { recursive: true, force: true });
      }
      this.size = info.size;
      this.resumable = !!info.resumable && info.size > 0;
      this.validators = { etag: info.etag || null, lastModified: info.lastModified || null };

      if (!this.dest) {
        const fileName = chooseName({ url: info.finalUrl, headers: info.headers || {}, suggested: this.suggestedName });
        this.dest = this.chooseDest ? await this.chooseDest({ fileName, size: this.size, mime: (info.headers || {})['content-type'] || '' }) : fileName;
      } else if (!fresh && saved.dest) this.dest = saved.dest;
      this.emit('resolved', { fileName: path.basename(this.dest), size: this.size, resumable: this.resumable, dest: this.dest, finalUrl: info.finalUrl });

      await fsp.mkdir(this.tempDir, { recursive: true });
      if (!fresh) {
        this.segments = saved.segments;
        // Sürdürülemeyen indirme yarıda kaldıysa baştan başlar
        if (!this.resumable && !allDone(this.segments)) {
          this.emit('warning', 'not_resumable_restart');
          for (const s of this.segments) await fsp.rm(this.partFile(s), { force: true });
          this.segments = initialPlan(this.size, 1, this.minSegment);
        } else if (first) { first.destroy(); first = null; }
      } else {
        this.segments = initialPlan(this.size, this.resumable ? this.connections : 1, this.minSegment);
      }
      if (first && this.segments[0].pos !== 0) { first.destroy(); first = null; }
      await this.saveState();

      this.setStatus('downloading');
      this._samples = [[Date.now(), totalReceived(this.segments)]];
      timer = setInterval(() => this._tickProgress(), this.progressMs);
      saver = setInterval(() => { this.saveState().catch(() => {}); }, 1000);

      const n = this.resumable ? this.connections : 1;
      const workers = [];
      for (let i = 0; i < n; i++) workers.push(this._worker(i, signal, i === 0 ? first : null));
      first = null;
      const results = await Promise.allSettled(workers);
      clearInterval(timer); timer = null;
      clearInterval(saver); saver = null;
      this._tickProgress();
      const failed = results.find((r) => r.status === 'rejected');
      if (this._paused) { await this.saveState(); this.setStatus('paused'); return; }
      if (failed) throw failed.reason;
      if (!allDone(this.segments) && this.size != null) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });

      if (this.size == null) {
        // Boyutu bilinmeyen akış: tek bölüm akış bitince kapanır
        const s = this.segments[0];
        this.size = s.pos - s.start;
        s.end = s.pos - 1;
      }
      this.setStatus('assembling');
      await this._assemble();
      this.setStatus('completed');
      this.emit('done', { file: this.dest, size: this.size });
    } catch (e) {
      if (timer) clearInterval(timer);
      if (saver) clearInterval(saver);
      if (this._paused) { await this.saveState().catch(() => {}); this.setStatus('paused'); return; }
      await this.saveState().catch(() => {});
      this.error = e;
      this.setStatus('error');
      this.emit('error', e);
    } finally {
      this._busy.clear();
      this._ctl = null;
    }
  }

  _sameFile(saved, info) {
    if (saved.size !== (info.size ?? null)) return false;
    if (saved.etag && info.etag && saved.etag !== info.etag) return false;
    if (saved.lastModified && info.lastModified && saved.lastModified !== info.lastModified) return false;
    return true;
  }

  async _worker(no, signal, first) {
    for (;;) {
      if (signal.aborted) return;
      const seg = nextSegment(this.segments, (id) => this._busy.has(id), this.minSegment);
      if (!seg) return;
      this._busy.set(seg.id, no);
      try {
        await this._fetchSegment(seg, signal, first);
      } finally {
        first = null;
        this._busy.delete(seg.id);
      }
    }
  }

  async _fetchSegment(seg, signal, first) {
    let attempt = 0;
    while (!isDone(seg) && !signal.aborted) {
      const before = seg.pos;
      try {
        const stream = first || (await this.transport.open({ start: seg.pos, end: seg.end, signal }));
        first = null;
        await this._pump(seg, stream, signal);
        if (seg.end === Infinity) { seg.end = seg.pos - 1; return; } // boyutu bilinmeyen akış bitti
        if (!isDone(seg) && !signal.aborted) throw Object.assign(new Error('short read'), { code: 'short_read', transient: true });
      } catch (e) {
        if (signal.aborted) return;
        if (first) { first.destroy(); first = null; }
        const transient = e.transient !== undefined ? e.transient : ['network', 'timeout', 'refused', 'short_read', 'ECONNRESET', 'aborted'].includes(e.code) || !e.code;
        if (!transient) throw e;
        if (seg.pos > before) attempt = 0; // ilerleme oldu: sayaç sıfırlanır
        if (++attempt > this.retries) throw e;
        // Sürdürülemeyen tek bağlantılı indirme kopunca baştan alınır
        if (!this.resumable && seg.pos > seg.start) {
          await fsp.rm(this.partFile(seg), { force: true });
          seg.pos = seg.start;
        }
        this.emit('retry', { segment: seg.id, attempt, code: e.code });
        await sleep(this.retryDelay(attempt), signal);
      }
    }
  }

  async _pump(seg, stream, signal) {
    const fh = await fsp.open(this.partFile(seg), 'a');
    try {
      const onAbort = () => stream.destroy();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        for await (let chunk of stream) {
          if (signal.aborted) break;
          // Bölüm bu arada bölünmüş olabilir: yalnız kendi aralığımızı yaz
          await takeAll([...this.globalBuckets, this.bucket], chunk.length);
          if (signal.aborted) break;
          // Bölüm beklerken bölünmüş olabilir: yalnız kendi aralığımızı yaz. pos yazmadan ÖNCE ilerletilir ki
          // yazma sürerken yapılan bölme bu baytları başka bağlantıya vermesin (diskteki gerçek konum dosya boyutudur).
          const room = seg.end === Infinity ? chunk.length : seg.end - seg.pos + 1;
          if (room <= 0) break;
          if (chunk.length > room) chunk = chunk.subarray(0, room);
          seg.pos += chunk.length;
          await fh.write(chunk, 0, chunk.length);
          if (seg.end !== Infinity && seg.pos > seg.end) break;
        }
      } catch (e) {
        if (!signal.aborted) throw Object.assign(e, { transient: e.transient ?? true, code: e.code || 'network' });
      } finally {
        signal.removeEventListener('abort', onAbort);
        stream.destroy();
      }
    } finally {
      await fh.close();
    }
  }

  async _assemble() {
    const segs = [...this.segments].sort((a, b) => a.start - b.start);
    if (this.size != null && !covers(segs, this.size)) throw Object.assign(new Error('segments do not cover file'), { code: 'assemble_failed' });
    await fsp.mkdir(path.dirname(this.dest), { recursive: true });
    const tmpOut = `${this.dest}.mdtmp`;
    await fsp.rm(tmpOut, { force: true });
    // İlk parça hedef klasöre taşınır (aynı birimde kopyalama yok), diğerleri sonuna eklenir
    const firstPart = this.partFile(segs[0]);
    await fsp.writeFile(firstPart, '', { flag: 'a' }); // boş dosyada parça yoksa oluştur
    try {
      await fsp.rename(firstPart, tmpOut);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.copyFile(firstPart, tmpOut);
    }
    if (segs.length > 1) {
      const out = await fsp.open(tmpOut, 'a');
      try {
        const buf = Buffer.allocUnsafe(1024 * 1024);
        for (const s of segs.slice(1)) {
          const inp = await fsp.open(this.partFile(s), 'r');
          try {
            for (;;) {
              const { bytesRead } = await inp.read(buf, 0, buf.length, null);
              if (!bytesRead) break;
              await out.write(buf, 0, bytesRead);
            }
          } finally {
            await inp.close();
          }
        }
      } finally {
        await out.close();
      }
    }
    const st = await fsp.stat(tmpOut);
    if (this.size != null && st.size !== this.size) throw Object.assign(new Error(`size mismatch ${st.size} != ${this.size}`), { code: 'assemble_failed' });
    await renameRetry(tmpOut, this.dest);
    await fsp.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Windows'ta virüs tarayıcısı ya da dizin oluşturucu dosyayı kısa süre tutabilir: birkaç kez dene
async function renameRetry(from, to, tries = 10) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); } catch (e) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); }
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

module.exports = { DownloadTask, renameRetry, sleep };
