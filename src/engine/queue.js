'use strict';

// Kuyruklar ve zamanlayıcı (IDM: Ana kuyruk + kullanıcı kuyrukları).
//
// Kuyruk: { id, name, maxParallel, schedule: { enabled, start: 'HH:MM', stop: 'HH:MM'|'' , days: [0-6] (0 = Pazar; boş = her gün),
//           once: false }, after: 'none'|'exit'|'sleep'|'hibernate'|'shutdown' }
// İndirme kaydında: queue (kuyruk id ya da null), order (kuyruk içi sıra), status.
// Kuyruk "çalışıyor"ken sıradaki 'queued' indirmeler maxParallel'e kadar başlatılır; hepsi bitince kuyruk durur
// ve 'after' eylemi bildirilir. Saat dışarıdan verilir (test).

const MAIN = 'main';
const ACTIVE = new Set(['connecting', 'downloading', 'assembling']);

const defaultQueues = () => [{
  id: MAIN, name: '', maxParallel: 2,
  schedule: { enabled: false, start: '02:00', stop: '', days: [], once: false },
  after: 'none',
}];

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));

// Bu dakikada zamanlayıcının yapacağı iş: 'start' | 'stop' | null. fired: { start: gün anahtarı, stop: gün anahtarı }
function scheduleAction(queue, now, fired = {}) {
  const s = queue.schedule;
  if (!s || !s.enabled) return null;
  const days = Array.isArray(s.days) ? s.days : [];
  if (days.length && !days.includes(now.getDay())) return null;
  const t = hhmm(now);
  const today = dayKey(now);
  if (validTime(s.start) && t === s.start && fired.start !== today) return 'start';
  if (validTime(s.stop) && t === s.stop && fired.stop !== today) return 'stop';
  return null;
}

// Bir sonraki başlama zamanı (arayüzde "Sonraki: Pzt 02:00" göstermek için) — en çok 8 gün ileri bakar
function nextStart(queue, now) {
  const s = queue.schedule;
  if (!s || !s.enabled || !validTime(s.start)) return null;
  const [h, m] = s.start.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (d <= now) continue;
    if (s.days && s.days.length && !s.days.includes(d.getDay())) continue;
    return d;
  }
  return null;
}

// Çalışan kuyruklarda başlatılacak indirmeler (sıralı)
function pickToStart(downloads, queues, running) {
  const out = [];
  for (const q of queues) {
    if (!running.has(q.id)) continue;
    const inQ = downloads.filter((d) => d.queue === q.id);
    const active = inQ.filter((d) => ACTIVE.has(d.status)).length;
    const free = Math.max(0, (q.maxParallel || 1) - active);
    if (!free) continue;
    inQ.filter((d) => d.status === 'queued').sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, free).forEach((d) => out.push(d.id));
  }
  return out;
}

// Kuyruk işi bitti mi (bekleyen ve süren yok)
const queueIdle = (downloads, qid) => !downloads.some((d) => d.queue === qid && (d.status === 'queued' || ACTIVE.has(d.status)));

// Çalışma zamanı: kuyrukları başlatır/durdurur, her tick'te zamanlayıcıyı ve boş yerleri denetler.
// deps: { getDownloads(), getQueues(), start(id), stop(id), onQueueDone(queue), onChange(), now() }
function createQueueRunner(deps) {
  const now = deps.now || (() => new Date());
  const running = new Set();
  const fired = new Map(); // qid → { start, stop }
  let timer = null;

  function startQueue(qid) {
    running.add(qid);
    deps.onChange && deps.onChange();
    pump();
  }

  // Kuyruğu durdurur; süren indirmelerini de duraklatır (IDM'deki "Kuyruğu durdur")
  function stopQueue(qid, { pauseActive = true } = {}) {
    running.delete(qid);
    if (pauseActive) for (const d of deps.getDownloads()) if (d.queue === qid && ACTIVE.has(d.status)) deps.stop(d.id);
    deps.onChange && deps.onChange();
  }

  function pump() {
    const downloads = deps.getDownloads();
    for (const id of pickToStart(downloads, deps.getQueues(), running)) deps.start(id);
    for (const qid of [...running]) {
      if (queueIdle(deps.getDownloads(), qid)) {
        running.delete(qid);
        const q = deps.getQueues().find((x) => x.id === qid);
        deps.onChange && deps.onChange();
        if (q && deps.onQueueDone) deps.onQueueDone(q);
      }
    }
  }

  function tick() {
    const t = now();
    for (const q of deps.getQueues()) {
      const f = fired.get(q.id) || {};
      const act = scheduleAction(q, t, f);
      if (act === 'start') {
        fired.set(q.id, { ...f, start: dayKey(t) });
        if (!queueIdle(deps.getDownloads(), q.id)) startQueue(q.id);
        if (q.schedule.once) { q.schedule.enabled = false; deps.onChange && deps.onChange(); }
      } else if (act === 'stop') {
        fired.set(q.id, { ...f, stop: dayKey(t) });
        if (running.has(q.id)) stopQueue(q.id);
      }
    }
    pump();
  }

  return {
    startQueue, stopQueue, pump, tick,
    isRunning: (qid) => running.has(qid),
    running: () => [...running],
    begin(ms = 15000) { if (!timer) { timer = setInterval(tick, ms); if (timer.unref) timer.unref(); } },
    end() { clearInterval(timer); timer = null; },
  };
}

module.exports = { MAIN, ACTIVE, defaultQueues, scheduleAction, nextStart, pickToStart, queueIdle, createQueueRunner, validTime };
