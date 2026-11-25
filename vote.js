#!/usr/bin/env node
'use strict';

/**
 * Slash-command shim: `/vote <title> [artist]` -> `node jukorama.js vote <title> [artist]`.
 *
 * Wire it into any chat client / shell alias / bot that maps a leading
 * "/vote " to this file.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.error('Usage: /vote <song title> [artist]');
  process.exit(1);
}

const command = /^unvote\b/i.test(input) ? input : `vote ${input}`;
const args = [path.join(__dirname, 'jukorama.js'), ...splitArgs(command)];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);

/** Split on whitespace but keep quoted segments together. */
function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
