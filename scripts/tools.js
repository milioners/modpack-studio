// Сборщики Мастерской для установщика студии: Python 2.7 (как у игры) и Haxe 4.3.
// Берутся из TAS_TOOLS или Documents\modtankair\.tools и кладутся в resources\tools упакованной программы
// без лишнего: документации, тестов, Tk, установщиков и Haxe-библиотек других платформ.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PY_SKIP_DIRS = new Set(['doc', 'tcl', 'tools', 'include', 'libs', 'test', 'tests', 'idlelib', 'lib-tk', 'lib2to3', 'ensurepip', 'site-packages', 'msilib', 'bsddb', 'curses', 'hotshot']);
const HAXE_SKIP_DIRS = new Set(['cpp', 'cs', 'hl', 'java', 'js', 'jvm', 'lua', 'neko', 'php', 'python']);

function copyTree(src, dst, skipDir, skipFile) {
  let bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      if (skipDir(e.name)) continue;
      bytes += copyTree(s, d, skipDir, skipFile);
    } else if (!skipFile(e.name)) {
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(s, d);
      bytes += fs.statSync(s).size;
    }
  }
  return bytes;
}

function bundleTools(dest) {
  const src = process.env.TAS_TOOLS || path.join(os.homedir(), 'Documents', 'modtankair', '.tools');
  const py = [path.join(src, 'python27', 'runtime'), path.join(src, 'python27')].find((p) => fs.existsSync(path.join(p, 'python.exe')));
  const hx = path.join(src, 'haxe');
  if (!py || !fs.existsSync(path.join(hx, 'haxe.exe'))) {
    throw new Error(`Не найдены сборщики Мастерской в ${src} (нужны python27 и haxe). Укажите папку в TAS_TOOLS.`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  const pyBytes = copyTree(py, path.join(dest, 'python27'), (d) => PY_SKIP_DIRS.has(d.toLowerCase()), (f) => /\.(msi|pyc|pyo|chm|txt)$/i.test(f) && !/^LICENSE/i.test(f));
  const hxBytes = copyTree(hx, path.join(dest, 'haxe'), (d) => HAXE_SKIP_DIRS.has(d.toLowerCase()), (f) => /^haxelib\.exe$/i.test(f));
  return { python: pyBytes, haxe: hxBytes };
}

module.exports = { bundleTools };

if (require.main === module) {
  const dest = process.argv[2] || path.join(__dirname, '..', 'tools');
  const r = bundleTools(dest);
  console.log(`Сборщики → ${dest}: Python 2.7 ${(r.python / 1e6).toFixed(1)} МБ, Haxe ${(r.haxe / 1e6).toFixed(1)} МБ`);
}
