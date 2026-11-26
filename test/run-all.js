'use strict';

// One entry point for the packager: the terminal suite, then the web suite.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

for (const file of ['data-file.test.js', 'offline.test.js', 'web.test.js']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file), ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
