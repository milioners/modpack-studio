// Выпуск новой версии TankAir Studio в GitHub Releases (оттуда её получит автообновление).
//
//   1. Поднимите "version" в package.json и опишите изменения в CHANGELOG.md (раздел «## <версия>»).
//   2. node scripts/release.js           — соберёт установщик и покажет, что будет опубликовано
//      node scripts/release.js --publish — соберёт и опубликует релиз v<версия> через GitHub CLI (gh)
//
// В релиз уходят TankAir-Studio-Setup-<версия>.exe и .sha256 с его контрольной суммой — без неё программа обновление не примет.
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
  // --since=1.1.0 — собрать изменения всех версий новее указанной (если промежуточные не публиковались)
  const since = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);
  const out = [];
  for (let i = start + 1; start >= 0 && i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      const v = lines[i].slice(3).trim();
      if (!since || v === since) break;
      out.push('', `**Версия ${v}**`);
      continue;
    }
    out.push(lines[i]);
  }
  const text = out.join('\n').trim();
  if (!text) throw new Error(`В CHANGELOG.md нет раздела «## ${pkg.version}» с описанием изменений`);
  return text;
}

function main() {
  if (!pkg.updateRepo) throw new Error('В package.json не указан updateRepo');
  const text = notes();
  const setup = path.join(DIST, `TankAir-Studio-Setup-${pkg.version}.exe`);
  // --no-build: опубликовать уже собранный установщик (например, если сборка шла на другой машине)
  if (process.argv.includes('--no-build')) {
    if (!fs.existsSync(setup)) throw new Error(`Нет собранного ${path.basename(setup)} — запустите без --no-build`);
  } else {
    execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit', cwd: ROOT });
  }
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
  // Черновик → загрузка файлов с повторами (большие файлы при плохой связи обрываются) → публикация.
  // Пока релиз черновик, программы его не видят, поэтому наполовину загруженный релиз никому не попадёт.
  const gh = (args) => execFileSync('gh', [...args, '--repo', pkg.updateRepo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  gh(['release', 'create', tag, '--draft', '--target', 'main', '--title', `TankAir Studio ${pkg.version}`, '--notes-file', notesFile]);
  for (const file of [shaFile, setup]) {
    for (let attempt = 1; ; attempt++) {
      try {
        gh(['release', 'upload', tag, file, '--clobber']);
        break;
      } catch (e) {
        if (attempt >= 5) throw new Error(`Не удалось загрузить ${path.basename(file)}: ${e.message}`);
        console.log(`Повтор загрузки ${path.basename(file)} (${attempt})…`);
      }
    }
  }
  const names = gh(['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name']).split(/\r?\n/);
  if (!names.includes(path.basename(setup)) || !names.includes(path.basename(shaFile))) throw new Error('В релизе не хватает файлов — он остался черновиком');
  gh(['release', 'edit', tag, '--draft=false']);
  console.log('Опубликовано. Установленные программы увидят обновление при следующем запуске.');
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
