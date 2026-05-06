import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const outputDir = join(distDir, 'server');
const outputFile = join(outputDir, 'src', 'server', 'index.js');

await rm(distDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(dirname(outputFile), { recursive: true });
await build({
  entryPoints: [join(root, 'src', 'server', 'index.js')],
  outfile: outputFile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
});

console.log('Built Devvit server bundle into dist/server/src/server/index.js');
