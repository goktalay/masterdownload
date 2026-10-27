'use strict';

// i18n: 8 dilde anahtar eşliği, yer tutucu eşliği, koddaki her anahtarın sözlükte olması

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18N = require('../src/i18n');

const LANGS = ['tr', 'en', 'fr', 'de', 'es', 'ar', 'zh', 'ru'];
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

test('8 dil tanımlı, sıra sabit, Arapça sağdan sola', () => {
  assert.deepStrictEqual(Object.keys(I18N.LANGUAGES), LANGS);
  assert.strictEqual(I18N.LANGUAGES.ar.dir, 'rtl');
  assert.strictEqual(I18N.resolveLanguage('tr-TR'), 'tr');
  assert.strictEqual(I18N.resolveLanguage('pt-BR'), 'en');
});

test('her dilde aynı anahtarlar ve aynı yer tutucular', () => {
  const en = I18N.STRINGS.en;
  for (const l of LANGS) {
    const d = I18N.STRINGS[l];
    assert.ok(d, `${l} sözlüğü yok`);
    assert.deepStrictEqual(Object.keys(d).sort(), Object.keys(en).sort(), `${l} anahtarları farklı`);
    for (const k of Object.keys(en)) assert.strictEqual(vars(d[k]), vars(en[k]), `${l}:${k} yer tutucuları farklı`);
  }
});

test('koddaki sabit anahtarların hepsi sözlükte', () => {
  const dir = path.join(__dirname, '..', 'src');
  const files = ['main.js', ...fs.readdirSync(path.join(dir, 'renderer')).filter((f) => f.endsWith('.js')).map((f) => path.join('renderer', f))];
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\(['`]([a-zA-Z0-9_.]+)['`]/g)) if (!(m[1] in I18N.STRINGS.en)) missing.push(`${f}: ${m[1]}`);
  }
  // Dinamik anahtar aileleri
  const dyn = [
    ...['compressed', 'documents', 'music', 'programs', 'video', 'general'].map((x) => `cat.${x}`),
    ...['paused', 'queued', 'connecting', 'downloading', 'assembling', 'completed', 'error'].map((x) => `st.${x}`),
    ...['none', 'exit', 'sleep', 'hibernate', 'shutdown'].map((x) => `after.${x}`),
    ...['exit', 'sleep', 'hibernate', 'shutdown'].map((x) => `after.countdown.${x}`),
    ...['all', 'unfinished', 'finished'].map((x) => `side.${x}`),
    ...['system', 'none', 'http', 'socks5'].map((x) => `set.proxy.${x}`),
    'set.dup.rename', 'set.dup.overwrite', 'warn.changed', 'warn.not_resumable_restart',
    'auth.errBadCredentials', 'auth.errUnverified', 'auth.errSuspended', 'auth.errRateLimited', 'auth.errOffline', 'auth.errSessionExpired',
  ];
  for (const k of dyn) if (!(k in I18N.STRINGS.en)) missing.push(k);
  assert.deepStrictEqual(missing, []);
});

test('t(): yer tutucu, İngilizceye ve anahtara düşme', () => {
  const t = I18N.createT('tr');
  assert.strictEqual(t('batch.added', { n: 3 }), '3 indirme eklendi');
  assert.strictEqual(t('yok.boyle'), 'yok.boyle');
});
