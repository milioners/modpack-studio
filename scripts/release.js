// Выпуск новой версии ModPack Studio в GitHub Releases (оттуда её получит автообновление).
//
//   1. Поднимите "version" в package.json и опишите изменения в CHANGELOG.md (раздел «## <версия>»).
//   2. node scripts/release.js           — соберёт установщик и покажет, что будет опубликовано
//      node scripts/release.js --publish — соберёт и опубликует релиз v<версия> через GitHub CLI (gh)
//
// В релиз уходят ModPack-Studio-Setup-<версия>.exe и .sha256 с его контрольной суммой — без неё программа обновление не примет.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const tag = `v${pkg.version}`;

function notes() {
  const lines = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${pkg.version}`);
  const out = [];
  for (let i = start + 1; start >= 0 && i < lines.length && !lines[i].startsWith('## '); i++) out.push(lines[i]);
  const text = out.join('\n').trim();
  if (!text) throw new Error(`В CHANGELOG.md нет раздела «## ${pkg.version}» с описанием изменений`);
  return text;
}

function main() {
  if (!pkg.updateRepo) throw new Error('В package.json не указан updateRepo');
  const text = notes();
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit', cwd: ROOT });
  const setup = path.join(DIST, `ModPack-Studio-Setup-${pkg.version}.exe`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(setup)).digest('hex');
  const shaFile = `${setup}.sha256`;
  fs.writeFileSync(shaFile, `${hash}  ${path.basename(setup)}\n`);
  const notesFile = path.join(DIST, 'release-notes.md');
  fs.writeFileSync(notesFile, text, 'utf8');

  console.log(`\nРелиз ${tag} → ${pkg.updateRepo}\n  ${path.basename(setup)}\n  ${path.basename(shaFile)}\n\n${text}\n`);
  if (!process.argv.includes('--publish')) {
    console.log('Это предпросмотр. Чтобы опубликовать: node scripts/release.js --publish');
    return;
  }
  execFileSync('gh', ['release', 'create', tag, setup, shaFile, '--repo', pkg.updateRepo, '--title', `ModPack Studio ${pkg.version}`, '--notes-file', notesFile],
    { stdio: 'inherit' });
  console.log('Опубликовано. Установленные программы увидят обновление при следующем запуске.');
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
