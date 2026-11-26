'use strict';

// The profile and the title cache are small JSON files. Writing one is a single
// temp file renamed into place. The write happens off the main thread and gives
// up if the disk does not answer: a network folder can wait forever on a locked
// file, and that wait used to freeze the whole program.

const fs = require('node:fs');
const path = require('node:path');

const WRITE_TIMEOUT = 8000;

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

/** Rejects if `promise` is still pending after `ms`. The disk call itself may go on. */
function within(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('timeout');
      error.code = 'ETIMEOUT';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function writeJson(file, value, { timeout = WRITE_TIMEOUT } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(value, null, 2);
  try {
    await within(fs.promises.writeFile(tmp, text), timeout);
    await within(fs.promises.rename(tmp, file), timeout);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    if (err.code === 'ETIMEOUT') {
      const error = new Error(`L’enregistrement de ${path.basename(file)} ne répond pas.`);
      error.code = 'ETIMEOUT';
      throw error;
    }
    throw err;
  }
}

module.exports = { readJson, writeJson };
