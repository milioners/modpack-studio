'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { tmpDir } = require('./helpers');

const project = require('../src/core/project');
const online = require('../src/core/online');
const builds = require('../src/core/builds');
const inno = require('../src/core/inno');
const { createDemo } = require('../src/core/demo');

const CATALOG = path.join(__dirname, '..', 'catalog-online', 'index.json');
const noFetch = () => { throw new Error('сеть в тестах не используется'); };

test('версия модпака: +0.1 и +1.0', () => {
  assert.strictEqual(project.bumpVersion('1.0'), '1.1');
  assert.strictEqual(project.bumpVersion('1.9'), '1.10');
  assert.strictEqual(project.bumpVersion('2.3.4', 'major'), '3.0');
});

test('«Что нового»: последние версии с текстом, новые сверху', () => {
  const p = project.normalize({ changelog: [
    { version: '1.3', date: '2026-10-20T00:00:00Z', text: '• новое' },
    { version: '1.2', text: '' },
    { version: '1.1', text: '• старое' },
    { version: '1.0', text: '• первое' },
    { version: '0.9', text: '• совсем старое' },
  ] });
  const t = project.changelogText(p);
  assert.match(t, /^Версия 1\.3 — 20 октября 2026/);
  assert.ok(t.includes('Версия 1.1') && t.includes('Версия 1.0'));
  assert.ok(!t.includes('1.2') && !t.includes('0.9'), 'пустые и слишком старые записи не попадают');
});

test('сравнение версий', () => {
  assert.strictEqual(online.compareVersions('1.10', '1.9'), 1);
  assert.strictEqual(online.compareVersions('v1.1.0', '1.1'), 0);
  assert.strictEqual(online.compareVersions('1.0.1', '1.1'), -1);
});

test('каталог: проверка формата и абсолютные адреса', () => {
  assert.throws(() => online.parseCatalog({ mods: [] }, 'https://x/'), /не каталог/);
  const cat = online.parseCatalog({
    format: 'modpack-studio-catalog',
    mods: [
      { id: 'ok', name: 'A', download: 'mods/ok/a.zip', preview: 'mods/ok/p.png', sha256: 'AB', homepage: 'http://insecure' },
      { id: '../bad', download: 'x.zip' },
      { id: 'ok', download: 'dup.zip' },
      { id: 'nodl' },
    ],
  }, 'https://example.com/catalog/index.json');
  assert.strictEqual(cat.mods.length, 1);
  assert.strictEqual(cat.mods[0].download, 'https://example.com/catalog/mods/ok/a.zip');
  assert.strictEqual(cat.mods[0].sha256, 'ab');
  assert.strictEqual(cat.mods[0].homepage, '', 'только https-ссылки на автора');
  assert.throws(() => online.resolveUrl('https://x/', 'javascript:alert(1)'));
});

test('каталог из репозитория загружается и файлы совпадают с контрольными суммами', async () => {
  const cat = await online.loadCatalog(noFetch, CATALOG);
  assert.ok(cat.mods.length >= 1);
  const dir = tmpDir();
  for (const m of cat.mods) {
    const p = await online.download(noFetch, m.download, dir, { hash: m.sha256 });
    assert.strictEqual(fs.statSync(p).size, m.size);
  }
});

test('подменённый файл не проходит проверку', async () => {
  const dir = tmpDir();
  const f = path.join(dir, 'mod.zip');
  fs.writeFileSync(f, 'оригинал');
  const good = online.sha256(Buffer.from('оригинал'));
  fs.writeFileSync(f, 'подмена');
  await assert.rejects(online.download(noFetch, pathToFileURL(f).href, path.join(dir, 'out'), { hash: good }), /Контрольная сумма/);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'mod.zip')));
  await assert.rejects(online.download(noFetch, pathToFileURL(f).href, path.join(dir, 'out'), { maxBytes: 3 }), /слишком большой/);
});

test('автообновление: разбор релиза GitHub', () => {
  const { parseRelease } = require('../src/main/updater');
  const asset = (name) => ({ name, size: 10, browser_download_url: `https://github.com/x/${name}` });
  const rel = { tag_name: 'v1.2.0', body: 'новое', assets: [asset('ModPack-Studio-Setup-1.2.0.exe'), asset('ModPack-Studio-Setup-1.2.0.exe.sha256')] };
  const r = parseRelease(rel, '1.1.0');
  assert.ok(r.available);
  assert.strictEqual(r.version, '1.2.0');
  assert.ok(r.shaUrl.endsWith('.sha256'));
  assert.ok(!parseRelease(rel, '1.2.0').available, 'та же версия — не обновление');
  assert.ok(!parseRelease({ ...rel, assets: [rel.assets[0]] }, '1.1.0').available, 'без контрольной суммы не обновляемся');
  assert.ok(!parseRelease({ ...rel, prerelease: true }, '1.1.0').available, 'предварительные версии пропускаем');
});

test('история сборок', () => {
  const out = tmpDir();
  fs.writeFileSync(path.join(out, 'a_1_0.exe'), 'x');
  fs.writeFileSync(path.join(out, 'a_1_1.exe'), 'yy');
  builds.record(out, { file: 'a_1_0.exe', version: '1.0', builtAt: '2026-10-01T00:00:00Z', size: 1, mods: 3 });
  builds.record(out, { file: 'a_1_1.exe', version: '1.1', builtAt: '2026-10-02T00:00:00Z', size: 2, mods: 4 });
  builds.record(out, { file: 'gone.exe', version: '0.9', builtAt: '2026-09-01T00:00:00Z', size: 1, mods: 1 });
  assert.deepStrictEqual(builds.list(out).map((b) => b.version), ['1.1', '1.0'], 'новые сверху, удалённые файлы скрыты');
  builds.remove(out, 'a_1_0.exe');
  assert.ok(!fs.existsSync(path.join(out, 'a_1_0.exe')));
  assert.throws(() => builds.remove(out, '../evil.exe'));
});

test('установщик: тёмная тема, «Что нового», запуск игры', { skip: !inno.findIscc() }, async () => {
  const dir = path.join(tmpDir(), 'demo');
  const p = createDemo(dir, path.join(__dirname, '..', 'catalog'));
  p.options.compression = 'fast';
  p.changelog = [{ version: '1.0', date: new Date().toISOString(), text: '• Первый выпуск' }];
  const { issPath, exePath } = inno.buildIss(dir, p, {});
  const iss = fs.readFileSync(issPath, 'utf8');
  assert.match(iss, /WizardStyle=modern dark/);
  assert.match(iss, /InfoBeforeFile=/);
  assert.match(iss, /\[Run\][\s\S]*GameExeExists/);
  const notes = fs.readFileSync(path.join(path.dirname(issPath), '.build', 'changelog.txt'), 'utf8');
  assert.match(notes, /Первый выпуск/);
  await inno.compileIss(issPath);
  assert.ok(fs.existsSync(exePath));

  p.options.showChangelog = false;
  p.options.launchGame = false;
  p.design.theme = 'light';
  const iss2 = fs.readFileSync(inno.buildIss(dir, p, {}).issPath, 'utf8');
  assert.ok(!/InfoBeforeFile=/.test(iss2) && !/\[Run\]/.test(iss2) && /WizardStyle=modern\r?\n/.test(iss2));
});
