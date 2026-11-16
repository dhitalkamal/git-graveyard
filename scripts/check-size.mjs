#!/usr/bin/env node
// Fails when a source file passes the 500-line cap in .kiro/steering/structure.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX = 500;
const root = new URL('..', import.meta.url).pathname;
const over = [];
for (const dir of ['bin', 'src', 'scripts']) {
  for (const f of readdirSync(join(root, dir))) {
    if (!/\.(js|mjs|html|css)$/.test(f)) continue;
    const n = readFileSync(join(root, dir, f), 'utf8').split('\n').length;
    if (n > MAX) over.push(`${dir}/${f}: ${n} lines`);
  }
}
if (over.length) {
  console.error(`Over the ${MAX}-line cap (split by job, see .kiro/steering/structure.md):\n  ${over.join('\n  ')}`);
  process.exit(1);
}
console.log(`All source files are under ${MAX} lines.`);
