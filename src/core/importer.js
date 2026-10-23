// Разбор мода из .mtmod (формат Lesta), старого .wotmod, .zip или папки.
// Раскладка определяется автоматически: содержимое mods/<версия>/ и res_mods/<версия>/
// переносится в папки той версии игры, куда будет ставиться модпак; одиночные .mtmod/.wotmod — в mods/<версия>/.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { listFiles } = require('./fsutil');

const PACKAGE_RE = /\.(mtmod|wotmod)$/i; // .mtmod — формат Lesta, .wotmod — старые моды
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;
const SKIP_RE = /\.(txt|md|url|html?|pdf|docx?|rtf|nfo)$/i;
const VERSION_DIR_RE = /^\d+(\.\d+)+( Common Test)?$/i;

// Безопасная распаковка zip (защита от путей с ../)
function extractZip(zipPath, dest) {
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    const target = path.resolve(dest, name);
    if (!target.startsWith(path.resolve(dest) + path.sep)) throw new Error(`Подозрительный путь в архиве: ${name}`);
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
  }
}

// Куда положить файл из мода. null — файл не нужен игре (readme, картинки в корне).
function mapFile(rel) {
  const parts = rel.split('/');
  const i = parts.findIndex((p) => p.toLowerCase() === 'res_mods' || p.toLowerCase() === 'mods');
  if (i >= 0 && i < parts.length - 1) {
    const root = parts[i].toLowerCase();
    const rest = VERSION_DIR_RE.test(parts[i + 1]) ? parts.slice(i + 2) : parts.slice(i + 1);
    if (rest.length) return `${root}/{game_version}/${rest.join('/')}`;
  }
  const name = parts[parts.length - 1];
  if (PACKAGE_RE.test(name)) return `mods/{game_version}/${name}`;
  if (parts.length === 1 && (SKIP_RE.test(name) || IMAGE_RE.test(name))) return null;
  return `res_mods/{game_version}/${rel}`;
}

// Готовит источник во временной папке и описывает, что и куда будет установлено.
// После использования вызовите cleanup(analysis).
function analyze(sourcePath) {
  const st = fs.statSync(sourcePath);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-import-'));
  const baseName = path.basename(sourcePath).replace(/\.(zip|mtmod|wotmod)$/i, '');
  try {
    if (st.isDirectory()) {
      fs.cpSync(sourcePath, staging, { recursive: true });
    } else if (/\.zip$/i.test(sourcePath)) {
      extractZip(sourcePath, staging);
    } else if (PACKAGE_RE.test(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(staging, path.basename(sourcePath)));
    } else {
      throw new Error('Поддерживаются файлы .mtmod (и старые .wotmod), архивы .zip и папки');
    }
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }

  // Если в архиве одна папка верхнего уровня (кроме mods/res_mods) — заходим в неё
  let root = staging;
  for (;;) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    if (entries.length === 1 && entries[0].isDirectory() && !/^(res_)?mods$/i.test(entries[0].name)) {
      root = path.join(root, entries[0].name);
    } else break;
  }

  const files = [];
  const skipped = [];
  const images = [];
  for (const abs of listFiles(root)) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const dst = mapFile(rel);
    if (IMAGE_RE.test(rel) && !rel.includes('/')) images.push(path.join(root, rel));
    if (dst) files.push({ rel, dst, size: fs.statSync(abs).size });
    else skipped.push(rel);
  }
  const readme = skipped.find((f) => /readme|описание|инструкция/i.test(f) && /\.(txt|md)$/i.test(f));
  let description = '';
  if (readme) {
    try {
      description = fs.readFileSync(path.join(root, readme), 'utf8').trim().slice(0, 2000);
    } catch { /* не текст */ }
  }
  const version = (baseName.match(/[_\s-]v?(\d+(?:\.\d+)+)$/i) || [])[1] || '';
  const name = baseName.replace(/[_\s-]v?\d+(?:\.\d+)+$/i, '').replace(/^[a-z]+\./i, '').replace(/[_-]+/g, ' ').trim() || baseName;
  return { staging, root, files, skipped, images, suggested: { name, version, description } };
}

function cleanup(analysis) {
  if (analysis?.staging) fs.rmSync(analysis.staging, { recursive: true, force: true });
}

module.exports = { analyze, cleanup, mapFile, extractZip, PACKAGE_RE, IMAGE_RE };
