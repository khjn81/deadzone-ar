import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = path.join(repositoryRoot, 'public', 'game', 'src', 'vendor');
const bundlePath = path.join(vendorDirectory, 'three-runtime.mjs');

await mkdir(vendorDirectory, { recursive: true });
await build({
  entryPoints: [path.join(vendorDirectory, 'three-runtime-entry.mjs')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  minify: true,
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
  banner: {
    js: '/*! Three.js 0.185.1 | MIT License | https://threejs.org/license */'
  }
});

const bundle = await readFile(bundlePath, 'utf8');
await Promise.all([
  writeFile(bundlePath, bundle.replace(/^ +\t/gm, '\t').replace(/[\t ]+$/gm, '')),
  copyFile(
    path.join(repositoryRoot, 'node_modules', 'three', 'LICENSE'),
    path.join(vendorDirectory, 'THREE-LICENSE.txt')
  )
]);
