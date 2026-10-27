'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tmpDir(prefix = 'md-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const fileSha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const waitFor = async (fn, ms = 5000, step = 10) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, step));
  }
};

module.exports = { tmpDir, fileSha, waitFor };
