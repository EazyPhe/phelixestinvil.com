import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const modules = process.env.M5_DEMO_TOOLCHAIN || resolve(root, 'node_modules');
const provenance = JSON.parse(await readFile(resolve(root, 'provenance.json'), 'utf8'));
for (const file of provenance.files) {
  const hash = createHash('sha256').update(await readFile(resolve(root, file.path))).digest('hex');
  if (hash !== file.sha256) throw new Error(`Vendored model changed: ${file.path}`);
}
const checked = spawnSync(process.execPath, [resolve(modules, 'typescript/bin/tsc'), '--project', resolve(root, 'tsconfig.json')], { stdio: 'inherit' });
if (checked.status !== 0) process.exit(checked.status || 1);
const { build } = await import(pathToFileURL(resolve(modules, 'vite/dist/node/index.js')).href);
await build({
  root, configFile: false, base: './', publicDir: false,
  build: { outDir: resolve(root, '../../src/demos/m5stack'), emptyOutDir: true, sourcemap: false, target: 'es2022' }
});
