/* Master Download eklentisi — seçenekler: yakalama, uzantılar, en küçük boyut, istisna siteler, video düğmesi */
'use strict';

(function () {
  const B = globalThis.browser || globalThis.chrome;
  const R = globalThis.MDRules;
  const t = (k, s) => B.i18n.getMessage(k, s) || k;
  const $ = (id) => document.getElementById(id);

  document.documentElement.lang = B.i18n.getUILanguage ? B.i18n.getUILanguage() : 'en';
  if (/^ar\b/.test(document.documentElement.lang)) document.documentElement.dir = 'rtl';
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  document.title = `${t('extName')} — ${t('optionsTitle')}`;

  function fill(s) {
    $('enabled').checked = s.enabled;
    $('exts').value = s.exts.join(' ');
    $('minSizeKB').value = String(s.minSizeKB);
    $('skipSites').value = s.skipSites.join('\n');
    $('videoButton').checked = s.videoButton;
  }

  function message(text, ok) {
    const n = $('msg');
    n.textContent = text;
    n.className = `msg ${ok ? 'ok' : 'err'}`;
  }

  async function load() {
    const o = await B.storage.local.get('settings');
    fill(R.normalizeSettings(o && o.settings));
  }

  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = R.normalizeSettings({
      enabled: $('enabled').checked,
      exts: $('exts').value,
      minSizeKB: $('minSizeKB').value,
      skipSites: $('skipSites').value,
      videoButton: $('videoButton').checked,
    });
    await B.storage.local.set({ settings: s });
    fill(s);
    message(t('optSaved'), true);
  });

  $('reset').addEventListener('click', async () => {
    const s = R.normalizeSettings({});
    await B.storage.local.set({ settings: s });
    fill(s);
    message(t('optSaved'), true);
  });

  $('ping').addEventListener('click', async () => {
    message(t('loading'), true);
    const r = await B.runtime.sendMessage({ type: 'ping' });
    message(r && r.ok ? t('statusConnected') : t('errAppUnavailable'), r && r.ok);
  });

  load().catch(() => fill(R.normalizeSettings({})));
}());
