// Empaqueta la extensión: node scripts/build.mjs chrome | firefox
// Chrome: el contenido de src/ tal cual. Firefox: lo mismo con el manifest ajustado (background con scripts en lugar de
// service worker, e id propio), en dist/firefox/. Deja el .zip en la raíz con la versión en el nombre.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const target = process.argv[2] || 'chrome';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'src');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const version = manifest.version;

let dir = src;
if (target === 'firefox') {
  dir = path.join(root, 'dist', 'firefox');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(src, dir, { recursive: true });
  const m = { ...manifest };
  m.background = { scripts: ['emote-dict.js', 'background.js'] };
  // El canal que miras se envía a decatron.net (traducción y emotes propios) y a 7TV, BTTV y FFZ (sus emotes)
  m.browser_specific_settings = { gecko: { id: 'decatron@decatron.net', strict_min_version: '140.0', data_collection_permissions: { required: ['browsingActivity'] } } };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
} else if (target !== 'chrome') {
  throw new Error('destino desconocido: ' + target);
}

const zip = path.join(root, `decatron-${target}-${version}.zip`);
fs.rmSync(zip, { force: true });
try {
  execSync(`cd "${dir}" && zip -qr "${zip}" . -x "*.DS_Store"`);
} catch {
  execSync(`python3 -c "import shutil;shutil.make_archive('${zip.replace(/\.zip$/, '')}','zip','${dir}')"`);
}
console.log(path.basename(zip));
