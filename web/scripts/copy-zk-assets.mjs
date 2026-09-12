/**
 * Copy the compiled contract into the web app.
 *
 *   ../managed/nightpot/keys     -> public/keys      (fetched by FetchZkConfigProvider)
 *   ../managed/nightpot/zkir     -> public/zkir      (fetched by FetchZkConfigProvider)
 *   ../managed/nightpot/contract -> src/generated/nightpot/contract
 *
 * The contract module is copied rather than imported across the repo so that it
 * resolves @midnight-ntwrk/compact-runtime from web/node_modules. Two runtime
 * copies in one bundle means two wasm instances that do not recognise each
 * other's objects. managed/ stays the single source of truth; nothing copied
 * here is committed.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const managed = join(web, '..', 'managed', 'nightpot');

if (!existsSync(join(managed, 'keys'))) {
  console.error('managed/nightpot/keys not found. Run `npm run compile` in the repo root first.');
  process.exit(1);
}

const copies = [
  [join(managed, 'keys'), join(web, 'public', 'keys')],
  [join(managed, 'zkir'), join(web, 'public', 'zkir')],
  [join(managed, 'contract'), join(web, 'src', 'generated', 'nightpot', 'contract')],
];

for (const [from, to] of copies) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`copied ${to.slice(web.length + 1)}`);
}
