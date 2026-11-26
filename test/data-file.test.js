'use strict';

// One save, no retry. A refused rename must leave the previous file as it was:
// the title cache is not worth a second profile or a loop of locked writes.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson } = require('../data-file.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jukorama-data-file-'));
const file = path.join(dir, 'tracks-index.json');
let failed = 0;

function test(name, fn) {
  const saved = {
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
    copyFileSync: fs.copyFileSync,
  };
  try {
    fn();
    console.log(` ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`        x ${err.message}`);
  } finally {
    Object.assign(fs, saved);
  }
}

test('a file round-trips and the temp file is removed', () => {
  writeJson(file, { party: 'p', tracks: { a: 1 } });
  assert.deepEqual(readJson(file, null), { party: 'p', tracks: { a: 1 } });
  writeJson(file, { party: 'p', tracks: { a: 2 } });
  assert.deepEqual(readJson(file, null), { party: 'p', tracks: { a: 2 } });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('a missing file and a broken file return the fallback', () => {
  assert.deepEqual(readJson(path.join(dir, 'absent.json'), { tracks: {} }), { tracks: {} });
  fs.writeFileSync(path.join(dir, 'half.json'), '{');
  assert.deepEqual(readJson(path.join(dir, 'half.json'), { tracks: {} }), { tracks: {} });
});

test('a locked read is reported once and is not taken for a missing file', () => {
  let calls = 0;
  fs.readFileSync = () => {
    calls += 1;
    const error = new Error('EBUSY');
    error.code = 'EBUSY';
    throw error;
  };
  assert.throws(() => readJson(file, { tracks: {} }), (error) => error.code === 'EBUSY');
  assert.equal(calls, 1);
});

test('a refused rename leaves the previous file untouched and tries nothing else', () => {
  writeJson(file, { ok: 1 });
  let copies = 0;
  fs.renameSync = () => {
    const error = new Error('EBUSY');
    error.code = 'EBUSY';
    throw error;
  };
  fs.copyFileSync = () => {
    copies += 1;
  };
  assert.throws(() => writeJson(file, { ok: 2 }), (error) => error.code === 'EBUSY');
  assert.equal(copies, 0);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: 1 });
});

fs.rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.log(`${failed} data-file check(s) failed.`);
  process.exit(1);
}
console.log('All data-file checks passed.');
