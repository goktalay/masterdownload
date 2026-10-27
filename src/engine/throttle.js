'use strict';

// Belirteç kovası hız sınırlayıcı. rate: bayt/sn (0 ya da boş = sınırsız).
// take(n) gereken belirteçler birikince çözülür; bekleyenler sırayla (FIFO) hizmet alır, böylece
// aynı kovayı paylaşan bağlantılar adil bölüşür. Kova en çok 1/4 saniyelik patlamaya izin verir.

function createBucket(rate = 0, { now = () => Date.now(), setTimer = setTimeout } = {}) {
  let r = Number(rate) || 0;
  let tokens = 0;
  let last = now();
  const waiters = [];
  let timer = null;

  const cap = () => Math.max(16 * 1024, r / 4);

  function refill() {
    const t = now();
    tokens = Math.min(cap(), tokens + ((t - last) / 1000) * r);
    last = t;
  }

  function pump() {
    timer = null;
    if (!r) { while (waiters.length) waiters.shift().resolve(); return; }
    refill();
    while (waiters.length) {
      const w = waiters[0];
      // Kova kapasitesinden büyük istekler parça parça karşılanır
      const need = Math.min(w.left, cap());
      if (tokens < need) break;
      tokens -= need;
      w.left -= need;
      if (w.left <= 0) { waiters.shift(); w.resolve(); }
    }
    if (waiters.length) {
      const need = Math.min(waiters[0].left, cap());
      const ms = Math.max(5, Math.ceil(((need - tokens) / r) * 1000));
      timer = setTimer(pump, ms);
    }
  }

  return {
    take(n) {
      if (!r || n <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push({ left: n, resolve });
        if (!timer) pump();
      });
    },
    setRate(v) {
      refill();
      r = Number(v) || 0;
      if (!r) tokens = 0;
      if (timer) { clearTimeout(timer); timer = null; }
      pump();
    },
    get rate() { return r; },
  };
}

// Birden çok kovadan (genel + indirme) sırayla belirteç alır
const takeAll = async (buckets, n) => { for (const b of buckets) if (b) await b.take(n); };

module.exports = { createBucket, takeAll };
