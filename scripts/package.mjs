import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const files = ['background.js', 'tracking.js', 'sudoku.js', 'content.js', 'popup.html', 'popup.css', 'popup.js'];
for (const browser of ['firefox', 'chromium']) {
  const target = new URL(`../dist/${browser}/`, import.meta.url);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const file of files) await cp(new URL(`../${file}`, import.meta.url), new URL(file, target));
  await cp(new URL('../icons/', import.meta.url), new URL('icons/', target), { recursive: true });
  const manifest = browser === 'firefox' ? 'manifest.json' : 'manifest.chromium.json';
  await writeFile(new URL('manifest.json', target), await readFile(new URL(`../${manifest}`, import.meta.url)));
  console.log(`Packaged dist/${browser}`);
}
