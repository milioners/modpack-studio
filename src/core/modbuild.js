// Сборка мода Мастерской: проверка и компиляция Python 2.7 (тем же интерпретатором, что у игры),
// Flash-экран Haxe → SWF в формате экранов игры, упаковка .mtmod. Сборщики (python27, haxe)
// ищутся в папке tools студии; при разработке — в Documents\modtankair\.tools.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const { listFiles } = require('./fsutil');
const workshop = require('./workshop');

const COMPILE_SCRIPT = path.join(__dirname, 'py', 'compile_mod.py');

const STEPS = [
  { id: 'check', title: 'Проверка кода' },
  { id: 'pyc', title: 'Компиляция .pyc' },
  { id: 'flash', title: 'Flash: Haxe → SWF' },
  { id: 'screens', title: 'Экраны мода' },
  { id: 'pack', title: 'Упаковка .mtmod' },
];

const ru = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

// ---------- сборщики ----------

function toolRoots(extra = []) {
  const roots = [...extra];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'tools'));
  roots.push(path.join(__dirname, '..', '..', 'tools'));
  roots.push(path.join(os.homedir(), 'Documents', 'modtankair', '.tools'));
  return roots;
}

function findTools(extra = []) {
  const pick = (cands) => cands.find((p) => p && fs.existsSync(p)) || null;
  const roots = toolRoots(extra);
  return {
    python: pick(roots.flatMap((r) => [path.join(r, 'python27', 'python.exe'), path.join(r, 'python27', 'runtime', 'python.exe')])),
    haxe: pick(roots.map((r) => path.join(r, 'haxe', 'haxe.exe'))),
  };
}

function run(exe, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60 * 1000, ...opts }, (err, stdout, stderr) => {
      if (err && !opts.allowFail) reject(Object.assign(new Error(String(stderr || stdout || err.message).trim()), { stdout: String(stdout), stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr), code: err ? err.code : 0 });
    });
  });
}

// ---------- Python ----------

function pyFiles(dir) {
  const scripts = path.join(dir, 'src', 'res');
  if (!fs.existsSync(scripts)) return [];
  return listFiles(scripts).filter((f) => f.endsWith('.py')).map((src) => {
    const rel = path.relative(path.join(dir, 'src', 'res'), src).replace(/\\/g, '/');
    return { src, rel, dst: path.join(dir, 'build', 'res', `${rel}c`) };
  });
}

// Проверка (checkOnly) или компиляция; ошибки — с файлом и строкой
async function compilePython(python, dir, checkOnly) {
  const files = pyFiles(dir);
  if (!files.length) return { errors: [], compiled: 0, files: 0 };
  if (!python) throw new Error('Не найден Python 2.7 для сборки — переустановите TankAir Studio');
  if (!checkOnly) for (const f of files) fs.mkdirSync(path.dirname(f.dst), { recursive: true });
  const jobs = path.join(os.tmpdir(), `tas-py-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(jobs, JSON.stringify({ check_only: !!checkOnly, files: files.map((f) => ({ src: f.src, dst: f.dst, rel: `src/res/${f.rel}` })) }), 'utf8');
  try {
    const { stdout } = await run(python, ['-E', '-S', COMPILE_SCRIPT, jobs], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    return { ...JSON.parse(stdout), files: files.length };
  } finally {
    fs.rmSync(jobs, { force: true });
  }
}

// Быстрая проверка одного файла (для редактора)
async function checkFile(python, dir, rel) {
  if (!rel.endsWith('.py')) return { errors: [] };
  const r = await compilePython(python, dir, true);
  return { errors: r.errors.filter((e) => e.file === rel) };
}

// ---------- Flash: разбор и сборка SWF ----------

function swfTags(buf) {
  let data = buf;
  const sig = data.slice(0, 3).toString('latin1');
  if (sig === 'CWS') data = Buffer.concat([data.slice(0, 8), zlib.inflateSync(data.slice(8))]);
  else if (sig !== 'FWS') throw new Error(`Не SWF (${sig})`);
  const nbits = data[8] >> 3;
  let pos = 8 + Math.ceil((5 + nbits * 4) / 8) + 4;
  const tags = [];
  while (pos < data.length) {
    const codeLen = data.readUInt16LE(pos);
    pos += 2;
    const code = codeLen >> 6;
    let len = codeLen & 0x3f;
    if (len === 0x3f) {
      len = data.readUInt32LE(pos);
      pos += 4;
    }
    tags.push({ code, body: data.slice(pos, pos + len) });
    pos += len;
    if (code === 0) break;
  }
  return tags;
}

function tag(code, body) {
  if (body.length < 0x3f && code !== 82) {
    const h = Buffer.alloc(2);
    h.writeUInt16LE((code << 6) | body.length);
    return Buffer.concat([h, body]);
  }
  const h = Buffer.alloc(6);
  h.writeUInt16LE((code << 6) | 0x3f);
  h.writeUInt32LE(body.length, 2);
  return Buffer.concat([h, body]);
}

// Экран для загрузчика игры: класс в спрайте id=1, символ → класс, экземпляр «main» на главной шкале
function packSwf(haxeSwf, className) {
  const abc = swfTags(haxeSwf).filter((t) => t.code === 72 || t.code === 82).map((t) => t.body);
  if (!abc.length) throw new Error('В сборке Haxe нет байткода');
  const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16LE(x, i * 2)); return b; };
  const parts = [tag(69, Buffer.from([0x08, 0, 0, 0])), tag(9, Buffer.from([0, 0, 0]))];
  for (const body of abc) parts.push(tag(82, body));
  parts.push(tag(39, Buffer.concat([u16(1, 1), tag(1, Buffer.alloc(0)), tag(0, Buffer.alloc(0))])));
  parts.push(tag(76, Buffer.concat([u16(1, 1), Buffer.from(`${className}\0`, 'latin1')])));
  parts.push(tag(26, Buffer.concat([Buffer.from([0x22]), u16(1, 1), Buffer.from('main\0', 'latin1')])));
  parts.push(tag(1, Buffer.alloc(0)), tag(0, Buffer.alloc(0)));
  // RECT 0..1920×1080 в твипах, 16 бит на число
  let bits = (16).toString(2).padStart(5, '0') + [0, 1920 * 20, 0, 1080 * 20].map((v) => v.toString(2).padStart(16, '0')).join('');
  bits += '0'.repeat((8 - (bits.length % 8)) % 8);
  const rect = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const body = Buffer.concat([rect, u16(30 << 8, 1), ...parts]);
  const head = Buffer.alloc(8);
  head.write('CWS', 0, 'latin1');
  head[3] = 17;
  head.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([head, zlib.deflateSync(body)]);
}

async function buildFlash(haxe, dir, mod) {
  const src = path.join(dir, 'flash', 'src');
  if (!fs.existsSync(src) || !mod.flashClass) return null;
  if (!haxe) throw new Error('Не найден Haxe для сборки Flash — переустановите TankAir Studio');
  const raw = path.join(dir, 'build', 'haxe_out.swf');
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  try {
    await run(haxe, ['-cp', src, '-main', mod.flashClass, '-swf', raw, '-swf-version', '11', '-D', 'no-swf-compress'], { cwd: dir });
  } catch (e) {
    throw new Error(`Haxe: ${e.message}`);
  }
  const out = path.join(dir, 'src', 'res', 'gui', 'flash', mod.flashSwf);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, packSwf(fs.readFileSync(raw), mod.flashClass));
  return { file: out, size: fs.statSync(out).size };
}

// ---------- экраны Gameface ----------

// Пути coui:// из кода мода и есть ли для них страница
function screens(dir) {
  const out = [];
  for (const f of pyFiles(dir)) {
    const text = fs.readFileSync(f.src, 'utf8');
    for (const m of text.matchAll(/coui:\/\/([\w./-]+\.html)/g)) {
      const page = path.join(dir, 'src', 'res', m[1]);
      out.push({ path: m[1], exists: fs.existsSync(page) });
    }
  }
  return out;
}

// ---------- упаковка ----------

function packMtmod(dir, mod) {
  const zip = new AdmZip();
  const add = (rel, data) => {
    zip.addFile(rel, data);
    zip.getEntry(rel).header.method = 0; // как у штатных .mtmod — без сжатия
  };
  const files = [];
  for (const base of [path.join(dir, 'build'), path.join(dir, 'src')]) {
    const res = path.join(base, 'res');
    if (!fs.existsSync(res)) continue;
    for (const f of listFiles(res)) {
      if (f.endsWith('.py')) continue;
      files.push([f, path.relative(base, f).replace(/\\/g, '/')]);
    }
  }
  const dirs = new Set();
  for (const [, rel] of files) {
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  add('meta.xml', fs.readFileSync(path.join(dir, 'src', 'meta.xml')));
  for (const d of [...dirs].sort()) zip.addFile(d, Buffer.alloc(0));
  for (const [f, rel] of files.sort((a, b) => a[1].localeCompare(b[1]))) add(rel, fs.readFileSync(f));
  const out = path.join(dir, 'dist', `${mod.id}_${mod.version}.mtmod`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  zip.writeZip(out);
  return { file: out, size: fs.statSync(out).size, files: files.length };
}

// Полная сборка; onStep(i, state, detail), state: run | done | skip | fail
async function build(dir, tools, onStep = () => {}) {
  const mod = workshop.readMod(dir);
  const step = async (i, fn) => {
    const t0 = Date.now();
    onStep(i, 'run', '');
    try {
      const r = await fn();
      onStep(i, r?.skip ? 'skip' : 'done', r?.detail || '', Date.now() - t0);
      return r;
    } catch (e) {
      onStep(i, 'fail', e.message, Date.now() - t0);
      throw e;
    }
  };
  fs.rmSync(path.join(dir, 'build', 'res'), { recursive: true, force: true });
  await step(0, async () => {
    const r = await compilePython(tools.python, dir, true);
    if (r.errors.length) {
      const e = r.errors[0];
      throw Object.assign(new Error(`${e.file}${e.line ? `, строка ${e.line}` : ''}: ${e.msg}`), { errors: r.errors });
    }
    return { detail: r.files ? `${r.files} ${ru(r.files, 'файл', 'файла', 'файлов')} Python 2.7 — ошибок нет` : 'скриптов нет' };
  });
  await step(1, async () => {
    const r = await compilePython(tools.python, dir, false);
    if (r.errors.length) throw new Error(r.errors[0].msg);
    return r.files ? { detail: `${r.compiled} .pyc тем же Python 2.7, что у игры` } : { skip: true, detail: 'нечего компилировать' };
  });
  await step(2, async () => {
    const r = await buildFlash(tools.haxe, dir, mod);
    return r ? { detail: `${path.basename(r.file)} · ${Math.max(1, Math.round(r.size / 1024))} КБ · класс ${mod.flashClass}` } : { skip: true, detail: 'Flash-экранов нет' };
  });
  await step(3, async () => {
    const list = screens(dir);
    const missing = list.filter((s) => !s.exists);
    if (missing.length) throw new Error(`Нет страницы ${missing[0].path}`);
    return list.length ? { detail: `${list.length} ${ru(list.length, 'экран', 'экрана', 'экранов')} Gameface — регистрация в res_map при первом запуске` } : { skip: true, detail: 'экранов Gameface нет' };
  });
  const packed = await step(4, async () => {
    const r = packMtmod(dir, mod);
    return { ...r, detail: `${path.basename(r.file)} · ${Math.max(1, Math.round(r.size / 1024))} КБ` };
  });
  const entry = { version: mod.version, file: packed.file, size: packed.size, builtAt: new Date().toISOString() };
  mod.builds = [entry, ...(mod.builds || []).filter((b) => b.version !== mod.version)].slice(0, 20);
  workshop.writeMod(dir, mod);
  return entry;
}

module.exports = { STEPS, findTools, compilePython, checkFile, swfTags, packSwf, packMtmod, screens, build };
