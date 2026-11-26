'use strict';

// The profile and the title cache are small JSON files. Writing one is a single
// temp file renamed into place: the previous file stays intact if the rename
// is refused, and nothing is retried or copied over it.

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // Missing is normal (first launch). Anything else, a lock included, is
    // reported: treating it as "no file" would create a second voting profile.
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // The next save overwrites this temp. The destination was not touched.
    }
    throw err;
  }
}

module.exports = { readJson, writeJson };
