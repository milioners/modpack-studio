// Мелкие файловые помощники.
'use strict';

const fs = require('fs');
const path = require('path');

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out.sort();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Ошибка в файле ${file}: ${e.message}`);
  }
}

// Запись через временный файл, чтобы не потерять проект при сбое
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sizeOf(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    return fs.readdirSync(p).reduce((s, n) => s + sizeOf(path.join(p, n)), 0);
  } catch {
    return 0;
  }
}

module.exports = { listFiles, readJson, writeJsonAtomic, sizeOf };
