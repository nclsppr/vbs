'use strict';

// One save, no retry. A refused rename must leave the previous file as it was,
// and a disk that never answers must give up instead of freezing the program.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson } = require('../data-file.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jukorama-data-file-'));
const file = path.join(dir, 'tracks-index.json');
const fsp = fs.promises;
let failed = 0;

async function test(name, fn) {
  const saved = { writeFile: fsp.writeFile, rename: fsp.rename, rm: fsp.rm };
  try {
    await fn();
    console.log(` ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`        x ${err.message}`);
  } finally {
    Object.assign(fsp, saved);
  }
}

async function main() {
  await test('a file round-trips and the temp file is removed', async () => {
    await writeJson(file, { party: 'p', tracks: { a: 1 } });
    assert.deepEqual(readJson(file, null), { party: 'p', tracks: { a: 1 } });
    await writeJson(file, { party: 'p', tracks: { a: 2 } });
    assert.deepEqual(readJson(file, null), { party: 'p', tracks: { a: 2 } });
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  });

  await test('a missing file and a broken file return the fallback', async () => {
    assert.deepEqual(readJson(path.join(dir, 'absent.json'), { tracks: {} }), { tracks: {} });
    fs.writeFileSync(path.join(dir, 'half.json'), '{');
    assert.deepEqual(readJson(path.join(dir, 'half.json'), { tracks: {} }), { tracks: {} });
  });

  await test('a locked read is reported once and is not taken for a missing file', async () => {
    let calls = 0;
    fs.readFileSync = () => {
      calls += 1;
      const error = new Error('EBUSY');
      error.code = 'EBUSY';
      throw error;
    };
    assert.throws(() => readJson(file, { tracks: {} }), (error) => error.code === 'EBUSY');
    assert.equal(calls, 1);
    fs.readFileSync = savedRead;
  });

  await test('a refused rename leaves the previous file untouched', async () => {
    await writeJson(file, { ok: 1 });
    fsp.rename = async () => {
      const error = new Error('EBUSY');
      error.code = 'EBUSY';
      throw error;
    };
    await assert.rejects(writeJson(file, { ok: 2 }), (error) => error.code === 'EBUSY');
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: 1 });
  });

  await test('a disk that never answers gives up and leaves the previous file', async () => {
    await writeJson(file, { ok: 1 });
    fsp.writeFile = () => new Promise(() => {});
    const started = Date.now();
    await assert.rejects(writeJson(file, { ok: 2 }, { timeout: 50 }), (error) => error.code === 'ETIMEOUT');
    assert.ok(Date.now() - started < 2000, 'the give-up is the timeout, not a long wait');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: 1 });
  });

  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) {
    console.log(`${failed} data-file check(s) failed.`);
    process.exit(1);
  }
  console.log('All data-file checks passed.');
}

const savedRead = fs.readFileSync;
main().catch((err) => {
  console.log(`FAIL  ${err.message}`);
  process.exit(1);
});
