// История сборок: output/builds.json хранит, что и когда собиралось.
'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('./fsutil');

const FILE = 'builds.json';

function list(outDir) {
  const data = readJson(path.join(outDir, FILE), { builds: [] });
  return data.builds
    .map((b) => ({ ...b, exePath: path.join(outDir, b.file), exists: fs.existsSync(path.join(outDir, b.file)) }))
    .filter((b) => b.exists)
    .sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

function record(outDir, entry) {
  const file = path.join(outDir, FILE);
  const data = readJson(file, { builds: [] });
  // одноимённый файл перезаписан — старая запись больше не верна
  data.builds = data.builds.filter((b) => b.file !== entry.file);
  data.builds.push(entry);
  fs.mkdirSync(outDir, { recursive: true });
  writeJsonAtomic(file, data);
}

function remove(outDir, fileName) {
  if (path.basename(fileName) !== fileName) throw new Error('Недопустимое имя файла');
  fs.rmSync(path.join(outDir, fileName), { force: true });
  const file = path.join(outDir, FILE);
  const data = readJson(file, { builds: [] });
  data.builds = data.builds.filter((b) => b.file !== fileName);
  writeJsonAtomic(file, data);
}

module.exports = { list, record, remove };
