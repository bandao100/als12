// Vérifie la syntaxe de chaque module et que le service worker met bien en cache tous les scripts.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const scripts = walk(join(root, 'js')).filter((f) => f.endsWith('.js'));
let failed = false;
for (const f of [...scripts, join(root, 'sw.js')]) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
    console.error(`Erreur de syntaxe : ${relative(root, f)}\n${e.stderr}`);
  }
}
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
for (const f of scripts) {
  const rel = `./${relative(root, f)}`;
  if (!sw.includes(`'${rel}'`)) {
    failed = true;
    console.error(`Absent du cache hors ligne (sw.js) : ${rel}`);
  }
}
if (failed) process.exit(1);
console.log(`${scripts.length + 1} fichiers vérifiés.`);
