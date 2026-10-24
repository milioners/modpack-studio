// Ведение онлайн-каталога модов (папка catalog-online/ в репозитории программы).
//
//   node scripts/catalog.js build        — собрать catalog-online/index.json (размеры и SHA-256 считаются сами)
//   node scripts/catalog.js add <файл> --id ID --name "Название" --category crosshair [--version 1.0] [--author …]
//                                       [--game 1.30] [--preview картинка.png] [--desc "Описание"] [--homepage https://…]
//   node scripts/catalog.js demo         — заполнить каталог демо-модами (для проверки)
//
// Каждый мод — папка catalog-online/mods/<id>/ с mod.json, файлом мода (.zip/.mtmod/.wotmod) и превью.
// Добавляйте только моды, которые разрешено распространять (с согласия автора) и которых нет в списке запрещённых Lesta.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..', 'catalog-online');
const MODS = path.join(ROOT, 'mods');
const PACKAGE_RE = /\.(zip|mtmod|wotmod)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;

const CATEGORIES = {
  crosshair: 'Прицелы', camera: 'Зум и камера', markers: 'Маркеры', lamp: 'Лампа и засвет',
  damage: 'Урон и статистика', minimap: 'Миникарта', hangar: 'Ангар', sound: 'Звуки', other: 'Разное',
};

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function build() {
  fs.mkdirSync(MODS, { recursive: true });
  const mods = [];
  for (const id of fs.readdirSync(MODS).sort()) {
    const dir = path.join(MODS, id);
    const metaFile = path.join(dir, 'mod.json');
    if (!fs.existsSync(metaFile)) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const files = fs.readdirSync(dir);
    const pkg = files.find((f) => PACKAGE_RE.test(f));
    if (!pkg) {
      console.warn(`! ${id}: нет файла мода (.zip/.mtmod/.wotmod), пропускаю`);
      continue;
    }
    const preview = meta.preview || files.find((f) => /^preview\./i.test(f) && IMAGE_RE.test(f));
    const p = path.join(dir, pkg);
    mods.push({
      id,
      name: meta.name || id,
      version: String(meta.version || '1.0'),
      author: meta.author || '',
      category: CATEGORIES[meta.category] ? meta.category : 'other',
      gameVersion: meta.gameVersion || '',
      description: meta.description || '',
      tags: meta.tags || [],
      homepage: meta.homepage || '',
      license: meta.license || '',
      updated: fs.statSync(p).mtime.toISOString(),
      size: fs.statSync(p).size,
      sha256: sha256(p),
      preview: preview ? `mods/${id}/${preview}` : null,
      download: `mods/${id}/${pkg}`,
    });
  }
  const index = {
    format: 'modpack-studio-catalog', version: 1, title: 'Каталог TankAir Studio',
    updated: new Date().toISOString(), categories: CATEGORIES, mods,
  };
  fs.writeFileSync(path.join(ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`index.json: ${mods.length} модов`);
}

function arg(name, def = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

function add() {
  const file = process.argv[3];
  const id = arg('id');
  if (!file || !fs.existsSync(file) || !PACKAGE_RE.test(file)) throw new Error('Укажите файл мода .zip/.mtmod/.wotmod');
  if (!/^[\w.-]+$/.test(id)) throw new Error('Укажите --id из латиницы, цифр, точек и дефисов');
  const dir = path.join(MODS, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (PACKAGE_RE.test(f)) fs.rmSync(path.join(dir, f));
  fs.copyFileSync(file, path.join(dir, path.basename(file)));
  const prev = arg('preview');
  if (prev) fs.copyFileSync(prev, path.join(dir, `preview${path.extname(prev).toLowerCase()}`));
  const metaFile = path.join(dir, 'mod.json');
  const old = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  const meta = {
    ...old,
    name: arg('name', old.name || id), version: arg('version', old.version || '1.0'), author: arg('author', old.author || ''),
    category: arg('category', old.category || 'other'), gameVersion: arg('game', old.gameVersion || ''),
    description: arg('desc', old.description || ''), homepage: arg('homepage', old.homepage || ''),
  };
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.log(`Добавлен ${id} ${meta.version}`);
  build();
}

// Демо-моды из встроенного примера: zip с res_mods/<версия>/modpack_demo/…
function demo() {
  const src = path.join(__dirname, '..', 'catalog');
  const cat = JSON.parse(fs.readFileSync(path.join(src, 'catalog.json'), 'utf8'));
  for (const m of cat.mods) {
    const dir = path.join(MODS, m.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zip = new AdmZip();
    const filesDir = path.join(src, 'mods', m.id, 'files');
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
        else zip.addFile(`res_mods/1.30.0.0/modpack_demo/${rel}${e.name}`, fs.readFileSync(p));
      }
    };
    walk(filesDir, '');
    zip.writeZip(path.join(dir, `${m.id}.zip`));
    if (m.preview) fs.copyFileSync(path.join(src, 'mods', m.id, m.preview), path.join(dir, `preview${path.extname(m.preview)}`));
    fs.writeFileSync(path.join(dir, 'mod.json'), `${JSON.stringify({
      name: m.name, version: m.version, author: m.author, category: m.category, gameVersion: '1.30',
      description: m.description, tags: m.tags || [], license: 'Демо',
    }, null, 2)}\n`, 'utf8');
  }
  build();
}

const cmd = process.argv[2];
try {
  if (cmd === 'build') build();
  else if (cmd === 'add') add();
  else if (cmd === 'demo') demo();
  else console.log('Команды: build | add <файл> --id … | demo');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
