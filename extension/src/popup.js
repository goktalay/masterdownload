/* Master Download eklentisi — araç çubuğu açılır penceresi: bu sekmede algılanan medya + tüm bağlantılar */
'use strict';

(function () {
  const B = globalThis.browser || globalThis.chrome;
  const R = globalThis.MDRules;
  const t = (k, s) => B.i18n.getMessage(k, s) || k;
  const $ = (id) => document.getElementById(id);

  document.documentElement.lang = B.i18n.getUILanguage ? B.i18n.getUILanguage() : 'en';
  if (/^ar\b/.test(document.documentElement.lang)) document.documentElement.dir = 'rtl';
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);

  let toastTimer = null;
  function toast(text, ok) {
    const n = $('toast');
    n.textContent = text;
    n.className = `toast ${ok ? 'ok' : 'err'}`;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { n.hidden = true; }, 2500);
  }
  const resText = (r) => (r && r.ok ? t('sentOk') : r && r.code === 'blocked' ? t('errBlocked')
    : r && r.code === 'no_links' ? t('noLinks') : t('errAppUnavailable'));

  async function main() {
    const [tab] = await B.tabs.query({ active: true, currentWindow: true });
    const tabId = tab ? tab.id : -1;

    // Uygulama bağlantısı durumu
    B.runtime.sendMessage({ type: 'ping' }).then((r) => {
      const n = $('status');
      n.classList.add(r && r.ok ? 'on' : 'off');
      n.title = r && r.ok ? t('statusConnected') : t('errAppUnavailable');
    }).catch(() => {});

    const m = tabId >= 0 ? await B.runtime.sendMessage({ type: 'getMedia', tabId }) : null;
    const list = $('media');
    list.textContent = '';
    if (!m || m.blocked || m.eme) {
      list.appendChild(Object.assign(document.createElement('p'), { className: 'muted', textContent: m ? t('errBlocked') : t('noMedia') }));
    } else if (!m.items.length) {
      list.appendChild(Object.assign(document.createElement('p'), { className: 'muted', textContent: t('noMedia') }));
    } else {
      for (const it of m.items) {
        const row = document.createElement('button');
        row.className = 'row';
        row.title = it.url;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = it.filename || R.fileNameOf(it.url) || R.hostOf(it.url);
        const kind = document.createElement('span');
        kind.className = 'kind';
        kind.textContent = it.kind === 'hls' ? 'HLS' : it.kind === 'dash' ? 'DASH' : t('kindFile');
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = [it.mime, R.formatSize(it.size), R.hostOf(it.url)].filter(Boolean).join(' · ');
        row.append(name, kind, meta);
        row.addEventListener('click', async () => {
          row.disabled = true;
          const r = await B.runtime.sendMessage({ type: 'sendMedia', tabId, item: it });
          row.disabled = false;
          toast(resText(r), r && r.ok);
        });
        list.appendChild(row);
      }
    }

    $('all').addEventListener('click', async () => {
      $('all').disabled = true;
      const r = await B.runtime.sendMessage({ type: 'collectAll', tabId });
      $('all').disabled = false;
      toast(resText(r), r && r.ok);
    });
  }

  $('opts').addEventListener('click', () => { B.runtime.openOptionsPage(); window.close(); });
  main().catch(() => {});
}());
