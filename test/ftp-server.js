'use strict';

// Testler için küçük gerçek FTP sunucusu (net). Komutlar: USER, PASS, TYPE, EPSV, PASV, SIZE, MDTM, REST, RETR, ABOR,
// QUIT (+ SYST, FEAT, PWD, NOOP, OPTS). Seçenekler:
//   users: { ad: parola }  (anonymous her zaman kabul)    files: { yol: Buffer }
//   bps: gönderim hızı (0 = sınırsız)    noEpsv: EPSV'ye 500 döner (PASV yedeği denenir)    noRest: REST'e 502 döner
// stats: { logins, retr: [başlangıç konumları], aborts, commands: {KOMUT: sayı} }

const net = require('net');

function startFtpServer({ users = { u: 'p' }, files = {}, bps = 0, noEpsv = false, noRest = false, mtime = new Date(Date.UTC(2024, 0, 2, 3, 4, 5)) } = {}) {
  const stats = { logins: 0, retr: [], aborts: 0, commands: {} };
  const opts = { bps, noEpsv, noRest };
  const sockets = new Set();

  const server = net.createServer((ctl) => {
    sockets.add(ctl);
    ctl.on('close', () => sockets.delete(ctl));
    ctl.on('error', () => {});
    const st = { user: null, authed: false, rest: 0, pasv: null, data: null, xfer: null };
    const reply = (code, text) => { if (!ctl.destroyed) ctl.write(`${code} ${text}\r\n`); };
    reply(220, 'md test ftp');

    const stopXfer = () => {
      if (st.xfer) { clearInterval(st.xfer); st.xfer = null; }
      if (st.data) { st.data.destroy(); st.data = null; }
    };
    const closePasv = () => { if (st.pasv) { st.pasv.close(); st.pasv = null; } };
    ctl.on('close', () => { stopXfer(); closePasv(); });

    // Pasif dinleyici: tek veri bağlantısı kabul eder
    const openPasv = () => new Promise((resolve) => {
      closePasv();
      const waiting = [];
      let conn = null;
      const srv = net.createServer((s) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
        s.on('error', () => {});
        conn = s;
        while (waiting.length) waiting.shift()(s);
        srv.close();
      });
      srv.listen(0, '127.0.0.1', () => {
        st.pasv = { close: () => srv.close(), get: () => (conn ? Promise.resolve(conn) : new Promise((r) => waiting.push(r))) };
        resolve(srv.address().port);
      });
    });

    const send = async (buf) => {
      const s = await st.pasv.get();
      closePasv();
      st.data = s;
      let off = 0;
      const done = () => { st.xfer = null; st.data = null; s.end(() => reply(226, 'Transfer complete')); };
      if (!opts.bps) { s.write(buf); return done(); }
      const tick = 50;
      const per = Math.max(1, Math.round((opts.bps * tick) / 1000));
      st.xfer = setInterval(() => {
        if (s.destroyed) { clearInterval(st.xfer); st.xfer = null; return; }
        const c = buf.subarray(off, off + per);
        off += c.length;
        s.write(c);
        if (off >= buf.length) { clearInterval(st.xfer); done(); }
      }, tick);
    };

    let lineBuf = '';
    ctl.on('data', (d) => {
      lineBuf += d.toString('latin1');
      let i;
      while ((i = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, i).replace(/\r$/, '');
        lineBuf = lineBuf.slice(i + 1);
        handle(line);
      }
    });

    function handle(line) {
      const sp = line.indexOf(' ');
      const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
      const arg = sp < 0 ? '' : line.slice(sp + 1);
      stats.commands[cmd] = (stats.commands[cmd] || 0) + 1;
      const file = () => files[arg] || files[`/${arg}`] || files[arg.replace(/^\//, '')];
      switch (cmd) {
        case 'USER': st.user = arg; return reply(331, 'Password required');
        case 'PASS':
          if (st.user === 'anonymous' || (st.user in users && users[st.user] === arg)) { st.authed = true; stats.logins++; return reply(230, 'Logged in'); }
          return reply(530, 'Login incorrect');
        case 'QUIT': reply(221, 'Bye'); return ctl.end();
        case 'SYST': return reply(215, 'UNIX Type: L8');
        case 'NOOP': return reply(200, 'OK');
        case 'FEAT': return reply(211, 'End');
        case 'OPTS': return reply(200, 'OK');
        case 'ABOR':
          stats.aborts++;
          if (st.data || st.xfer) { stopXfer(); reply(426, 'Transfer aborted'); }
          return reply(226, 'ABOR OK');
        default: break;
      }
      if (!st.authed) return reply(530, 'Not logged in');
      switch (cmd) {
        case 'PWD': return reply(257, '"/"');
        case 'TYPE': return reply(200, `Type set to ${arg}`);
        case 'EPSV':
          if (opts.noEpsv) return reply(500, 'EPSV not understood');
          return openPasv().then((port) => reply(229, `Entering Extended Passive Mode (|||${port}|)`));
        case 'PASV':
          return openPasv().then((port) => reply(227, `Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`));
        case 'SIZE': { const f = file(); return f ? reply(213, String(f.length)) : reply(550, 'No such file'); }
        case 'MDTM': {
          if (!file()) return reply(550, 'No such file');
          const p = (n, w = 2) => String(n).padStart(w, '0');
          return reply(213, `${mtime.getUTCFullYear()}${p(mtime.getUTCMonth() + 1)}${p(mtime.getUTCDate())}${p(mtime.getUTCHours())}${p(mtime.getUTCMinutes())}${p(mtime.getUTCSeconds())}`);
        }
        case 'REST':
          if (opts.noRest) return reply(502, 'REST not implemented');
          st.rest = Number(arg) || 0;
          return reply(350, `Restarting at ${st.rest}`);
        case 'RETR': {
          const f = file();
          const rest = st.rest;
          st.rest = 0;
          if (!f) { closePasv(); return reply(550, 'No such file'); }
          if (!st.pasv) return reply(425, 'Use PASV first');
          stats.retr.push(rest);
          reply(150, `Opening BINARY mode data connection (${f.length - rest} bytes)`);
          return send(f.subarray(rest));
        }
        default: return reply(502, 'Command not implemented');
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port, stats, files, base: `ftp://127.0.0.1:${port}`,
        set: (o) => Object.assign(opts, o),
        close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { startFtpServer };
