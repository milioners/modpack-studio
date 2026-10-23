// Сборка собственного установщика модпака (ModPack Installer).
// Итоговый .exe = программа-оболочка (C#/WPF, компилируется встроенным в Windows csc с иконкой модпака)
//                + zip с manifest.json, картинками и файлами модов + 8 байт длины zip + «MPSPACK1».
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { walk, changelogText } = require('./project');
const { safeName } = require('./inno');

const SRC_DIR = path.join(__dirname, '..', 'installer');
const MAGIC = Buffer.from('MPSPACK1', 'ascii');
const FW = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');

function findCsc() {
  const p = path.join(FW, 'csc.exe');
  return fs.existsSync(p) ? p : null;
}

// ---------- компиляция оболочки ----------

function versionNumbers(v) {
  const n = String(v || '1.0').split('.').map((x) => parseInt(x, 10) || 0).slice(0, 4);
  while (n.length < 4) n.push(0);
  return n.join('.');
}

const csStr = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');

// Возвращает путь к скомпилированной оболочке; одинаковые сборки берутся из кэша
async function compileStub({ icon, title, version, company, cacheDir }) {
  const csc = findCsc();
  if (!csc) throw new Error('Не найден компилятор C# из .NET Framework 4.8 (csc.exe). Он входит в Windows 10/11 — проверьте папку Windows\\Microsoft.NET.');
  const sources = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.cs')).sort().map((f) => path.join(SRC_DIR, f));
  const info = `using System.Reflection;
[assembly: AssemblyProduct("${csStr(title)}")]
[assembly: AssemblyDescription("Установщик модпака «${csStr(title)}» для «Мира танков»")]
[assembly: AssemblyCompany("${csStr(company)}")]
[assembly: AssemblyVersion("${versionNumbers(version)}")]
[assembly: AssemblyFileVersion("${versionNumbers(version)}")]
`;
  const h = crypto.createHash('sha256');
  for (const s of sources) h.update(fs.readFileSync(s));
  h.update(info);
  if (icon && fs.existsSync(icon)) h.update(fs.readFileSync(icon));
  const key = h.digest('hex').slice(0, 16);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `stub-${key}.exe`);
  if (fs.existsSync(out)) return out;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-csc-'));
  try {
    const infoFile = path.join(tmp, 'AssemblyInfo.cs');
    fs.writeFileSync(infoFile, `\ufeff${info}`, 'utf8');
    const manifestFile = path.join(tmp, 'app.manifest');
    fs.writeFileSync(manifestFile, `<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2"><security><requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
    <requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
  </windowsSettings></application>
</assembly>`, 'utf8');
    const tmpOut = path.join(tmp, 'stub.exe');
    const wpf = path.join(FW, 'WPF');
    const args = [
      '-nologo', '-target:winexe', '-optimize+', '-utf8output', '-codepage:65001', `-out:${tmpOut}`, `-win32manifest:${manifestFile}`,
      `-r:${path.join(wpf, 'PresentationFramework.dll')}`, `-r:${path.join(wpf, 'PresentationCore.dll')}`, `-r:${path.join(wpf, 'WindowsBase.dll')}`,
      `-r:${path.join(FW, 'System.Xaml.dll')}`, '-r:System.IO.Compression.dll', '-r:System.IO.Compression.FileSystem.dll',
      '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:Microsoft.CSharp.dll', '-r:System.Core.dll',
    ];
    if (icon && fs.existsSync(icon)) args.push(`-win32icon:${icon}`);
    args.push(infoFile, ...sources);
    await new Promise((resolve, reject) => {
      execFile(csc, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(new Error(`Ошибка компиляции установщика:\n${String(stdout).slice(-3000)}`));
        else resolve();
      });
    });
    fs.copyFileSync(tmpOut, out);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- zip ----------

const STORE_RE = /\.(zip|mtmod|wotmod|png|jpe?g|webp|gif|ogg|mp3|wav|bnk|fsb|pkg|dds|7z|rar)$/i;

function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function crcOfFile(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let crc = 0;
  let n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) crc = zlib.crc32(buf.subarray(0, n), crc);
  } finally {
    fs.closeSync(fd);
  }
  return crc;
}

// Пишет zip в открытый дескриптор out, начиная с текущей позиции base. Смещения внутри zip считаются от его начала.
// entries: [{ name, buffer }] или [{ name, file }]. Возвращает длину zip.
function writeZip(out, base, entries, onProgress = () => {}) {
  let pos = 0;
  const central = [];
  const { time, date } = dosTime();
  const write = (buf) => {
    fs.writeSync(out, buf, 0, buf.length, base + pos);
    pos += buf.length;
  };
  const total = entries.reduce((s, e) => s + (e.buffer ? e.buffer.length : fs.statSync(e.file).size), 0) || 1;
  let done = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    let data = null;
    let size;
    let crc;
    let method = 0;
    let comp;
    if (e.buffer || (!STORE_RE.test(e.name) && fs.statSync(e.file).size < 32 * 1024 * 1024)) {
      const raw = e.buffer || fs.readFileSync(e.file);
      size = raw.length;
      crc = zlib.crc32(raw);
      if (!STORE_RE.test(e.name) && raw.length > 64) {
        const d = zlib.deflateRawSync(raw, { level: 9 });
        if (d.length < raw.length) {
          data = d;
          method = 8;
        }
      }
      if (!data) data = raw;
      comp = data.length;
    } else {
      size = fs.statSync(e.file).size;
      crc = crcOfFile(e.file);
      comp = size;
    }
    if (size >= 0xffffffff || base + pos >= 0xffffffff) throw new Error('Модпак больше 4 ГБ — такой размер пока не поддерживается');
    const offset = pos;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // имена в UTF-8
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(comp, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    write(h);
    write(name);
    if (data) write(data);
    else {
      const fd = fs.openSync(e.file, 'r');
      const buf = Buffer.alloc(1 << 20);
      let n;
      try {
        while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
          write(buf.subarray(0, n));
          onProgress((done += n) / total);
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    if (data) onProgress((done += size) / total);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(comp, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, name]));
  }
  const cdStart = pos;
  for (const c of central) write(c);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(pos - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  write(eocd);
  return pos;
}

// ---------- сборка ----------

// assets: { previews: {id: Uint8Array png}, background, banner, logo (Uint8Array) }
function manifestAndEntries(projectDir, project, assets, includeMods) {
  const entries = [];
  const img = (name, data) => {
    if (!data || !data.length) return '';
    entries.push({ name: `img/${name}`, buffer: Buffer.from(data) });
    return `img/${name}`;
  };
  const th = project.installer;
  const theme = {
    ...th,
    bgImage: img('background.jpg', assets.background),
    banner: img('banner.jpg', assets.banner),
    logo: img('logo.png', assets.logo),
    texts: { ...th.texts },
  };
  const conv = (n) => {
    if (n.type === 'group') {
      return { id: n.id, type: 'group', name: n.name, description: n.description, mode: n.mode, checked: n.checked,
        image: img(`p_${n.id}.png`, assets.previews?.[n.id]), children: n.children.map(conv) };
    }
    const files = n.files.map((f, i) => {
      const src = `mods/${n.id}/${i}_${path.basename(f.src)}`;
      if (includeMods) entries.push({ name: src, file: path.resolve(projectDir, f.src) });
      return { src, dst: f.dst, size: f.size || 0 };
    });
    return { id: n.id, type: 'mod', name: n.name, version: n.version, author: n.author, description: n.description, checked: n.checked,
      image: img(`p_${n.id}.png`, assets.previews?.[n.id]), size: files.reduce((s, f) => s + f.size, 0), files };
  };
  const tree = project.tree.filter((n) => n.type !== 'group' || [...walk(n.children)].some((x) => x.node.type === 'mod')).map(conv);
  const manifest = {
    format: 'mps-installer', formatVersion: 1, appId: project.appId,
    info: project.info,
    options: { cleanDefault: project.options.cleanDefault, launchGame: project.options.launchGame },
    update: project.publish,
    changelog: project.options.showChangelog ? project.changelog.filter((e) => e.text.trim()) : [],
    theme,
    tree,
  };
  entries.unshift({ name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest), 'utf8') });
  return { manifest, entries };
}

// Собирает .exe. opts: { outFile, includeMods, stub, onProgress }
function pack(projectDir, project, assets, opts) {
  const { entries } = manifestAndEntries(projectDir, project, assets, opts.includeMods !== false);
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  const tmp = `${opts.outFile}.part`;
  fs.copyFileSync(opts.stub, tmp);
  const base = fs.statSync(tmp).size;
  const fd = fs.openSync(tmp, 'r+');
  try {
    const len = writeZip(fd, base, entries, opts.onProgress);
    const tail = Buffer.alloc(16);
    tail.writeBigInt64LE(BigInt(len), 0);
    MAGIC.copy(tail, 8);
    fs.writeSync(fd, tail, 0, 16, base + len);
  } finally {
    fs.closeSync(fd);
  }
  fs.rmSync(opts.outFile, { force: true });
  fs.renameSync(tmp, opts.outFile);
  return opts.outFile;
}

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function exeName(project) {
  return `${safeName(project.info.name)}_${safeName(project.info.version || '1.0')}.exe`;
}

// update.json для обновлений со своего сайта: кладётся рядом с установщиком
function writeUpdateJson(exePath, project) {
  const file = path.join(path.dirname(exePath), 'update.json');
  fs.writeFileSync(file, JSON.stringify({
    version: project.info.version, url: path.basename(exePath), sha256: sha256File(exePath),
    size: fs.statSync(exePath).size, notes: changelogText(project, 1),
  }, null, 2), 'utf8');
  return file;
}

// Снимок окна установщика без показа на экране (предпросмотр в конструкторе)
function screenshot(exe, screen, outPng) {
  return new Promise((resolve, reject) => {
    execFile(exe, [`--screenshot=${outPng}`, `--screen=${screen}`], { windowsHide: true, timeout: 30000 }, (err, _o, stderr) => {
      if (err || !fs.existsSync(outPng)) reject(new Error(`Не удалось нарисовать предпросмотр: ${stderr || (err && err.message)}`));
      else resolve(outPng);
    });
  });
}

module.exports = { findCsc, compileStub, writeZip, manifestAndEntries, pack, sha256File, exeName, writeUpdateJson, screenshot, MAGIC };
