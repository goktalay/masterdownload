'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./server');
const { grab, parseRobots } = require('../src/engine/grabber');
const { fetchText } = require('../src/engine/http');

test('robots.txt kuralları', () => {
  const ok = parseRobots('User-agent: *\nDisallow: /gizli/\nAllow: /gizli/acik\nDisallow: /*.php$\n');
  assert.strictEqual(ok('/gizli/x.zip'), false);
  assert.strictEqual(ok('/gizli/acik.zip'), true);
  assert.strictEqual(ok('/a.php'), false);
  assert.strictEqual(ok('/a.php?x'), true);
  assert.strictEqual(ok('/b.zip'), true);
});

test('site yakalayıcı: derinlik, tür filtresi, alan sınırı, robots', async () => {
  const srv = await startServer();
  try {
    const H = (s) => `<html><body>${s}</body></html>`;
    srv.setStatic('/robots.txt', 'User-agent: *\nDisallow: /static/gizli/\n', 'text/plain');
    srv.setStatic('/index.html', H('<a href="a.zip">a</a> <a href="alt/sayfa.html">alt</a> <img src="/static/r.jpg"> <a href="https://dis.example/x.zip">dış</a> <a href="gizli/g.zip">g</a>'), 'text/html');
    srv.setStatic('/alt/sayfa.html', H('<a href="b.zip">b</a><a href="derin.html">d</a>'), 'text/html');
    srv.setStatic('/alt/derin.html', H('<a href="c.zip">c</a>'), 'text/html');
    // setStatic yolları /static altında sunulur
    const start = `${srv.base}/static/index.html`;
    const r = await grab({ startUrl: start, depth: 1, exts: ['zip'], delayMs: 0, fetchText: (u) => fetchText(u) });
    const names = r.files.map((f) => f.url.replace(/^.*\//, '')).sort();
    assert.deepStrictEqual(names, ['a.zip', 'b.zip', 'x.zip'], 'derinlik 1: c.zip yok, robots: g.zip yok');
    const r2 = await grab({ startUrl: start, depth: 2, exts: ['jpg'], delayMs: 0, fetchText: (u) => fetchText(u) });
    assert.deepStrictEqual(r2.files.map((f) => f.ext), ['jpg']);
    assert.strictEqual(r2.pages, 3);
  } finally {
    await srv.close();
  }
});
