'use strict';

// Komut satırı (IDM ile uyumlu):
//   "Master Download.exe" /d URL [/p yerel_yol] [/f dosya_adı] [/q] [/n] [/a]
//   "Master Download.exe" /s          ana kuyruğu başlat
// /d indirilecek adres, /p klasör, /f dosya adı, /q bitince Master Download'dan çık, /n sessiz (soru sorma),
// /a ana kuyruğa ekle, başlatma. (/h — bitince bağlantıyı kes: çevirmeli ağlar içindi, desteklenmez.)
// Uzun biçimler: --url, --dir, --file, --quit, --silent, --add, --start-queue. --hidden: tepside başla.

function parseArgs(argv) {
  const out = { url: null, dir: null, fileName: null, quit: false, silent: false, addOnly: false, startQueue: false, hidden: false, files: [] };
  const take = (i) => (i + 1 < argv.length ? argv[i + 1] : null);
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    const k = a.toLowerCase();
    if (k === '/d' || k === '--url') { out.url = take(i); i++; }
    else if (k === '/p' || k === '--dir') { out.dir = take(i); i++; }
    else if (k === '/f' || k === '--file') { out.fileName = take(i); i++; }
    else if (k === '/q' || k === '--quit') out.quit = true;
    else if (k === '/n' || k === '--silent') out.silent = true;
    else if (k === '/a' || k === '--add') out.addOnly = true;
    else if (k === '/s' || k === '--start-queue') out.startQueue = true;
    else if (k === '--hidden') out.hidden = true;
    else if (/^(https?|ftp):\/\//i.test(a) && !out.url) out.url = a;
    else if (/\.(ef2|txt)$/i.test(a)) out.files.push(a); // bırakılan / "Birlikte aç" ile gelen liste dosyası
  }
  if (out.url && !/^(https?|ftp):\/\//i.test(out.url)) out.url = null;
  return out;
}

const hasWork = (o) => !!(o.url || o.startQueue || o.files.length);

module.exports = { parseArgs, hasWork };
