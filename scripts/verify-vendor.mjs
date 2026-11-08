import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [builders, marketplace] = process.argv.slice(2);
if (!builders || !marketplace) {
  console.error('Usage: node scripts/verify-vendor.mjs <builders checkout> <marketplace checkout>');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../vendor-lock.json', import.meta.url)));

for (const [name, checkout] of Object.entries({ builders, marketplace })) {
  const { revision, paths } = lock[name];
  const source = execFileSync('git', ['-C', checkout, 'ls-tree', '-r', revision, '--', ...paths]);
  const vendor = execFileSync('git', ['-C', root, 'ls-tree', '-r', 'HEAD', '--', ...paths]);
  if (!source.length || !source.equals(vendor)) {
    throw new Error(`Vendored ${name} files differ from ${revision}`);
  }
}
