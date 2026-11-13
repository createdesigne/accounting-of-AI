import { mkdir, readdir, rename } from 'node:fs/promises';
const dist = new URL('../dist/', import.meta.url);
const entries = await readdir(dist);
const target = new URL('accounting-of-AI/', dist);
await mkdir(target, { recursive: true });
for (const name of entries) {
  if (name === 'accounting-of-AI') continue;
  await rename(new URL(name, dist), new URL(name, target));
}
