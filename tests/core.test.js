'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { execFileSync } = require('child_process');
const { makeFakeGame, tmpDir } = require('./helpers');

const importer = require('../src/core/importer');
const project = require('../src/core/project');
const inno = require('../src/core/inno');
const { createDemo } = require('../src/core/demo');

const DEMO_CATALOG = path.join(__dirname, '..', 'catalog');

function sampleZip(dir) {
  const zip = new AdmZip();
  zip.addFile('BattleHits_v2.1/mods/1.29.0.0/me.battlehits_2.1.mtmod', Buffer.from('mtmod'));
  zip.addFile('BattleHits_v2.1/res_mods/1.29.0.0/configs/battlehits.json', Buffer.from('{}'));
  zip.addFile('BattleHits_v2.1/readme.txt', Buffer.from('Показывает попадания после боя'));
  zip.addFile('BattleHits_v2.1/preview.png', Buffer.from('png'));
  const p = path.join(dir, 'BattleHits_v2.1.zip');
  zip.writeZip(p);
  return p;
}

test('раскладка файлов мода по папкам игры', () => {
  assert.strictEqual(importer.mapFile('x.mtmod'), 'mods/{game_version}/x.mtmod');
  assert.strictEqual(importer.mapFile('old.wotmod'), 'mods/{game_version}/old.wotmod');
  assert.strictEqual(importer.mapFile('pack/mods/1.29.0.0/a/b.mtmod'), 'mods/{game_version}/a/b.mtmod');
  assert.strictEqual(importer.mapFile('res_mods/1.29.0.1/gui/x.xml'), 'res_mods/{game_version}/gui/x.xml');
  assert.strictEqual(importer.mapFile('res_mods/configs/x.json'), 'res_mods/{game_version}/configs/x.json');
  assert.strictEqual(importer.mapFile('readme.txt'), null);
  assert.strictEqual(importer.mapFile('gui/flash/a.swf'), 'res_mods/{game_version}/gui/flash/a.swf');
});

test('разбор архива: файлы, картинка, описание, имя и версия', () => {
  const a = importer.analyze(sampleZip(tmpDir()));
  try {
    assert.deepStrictEqual(a.files.map((f) => f.dst).sort(),
      ['mods/{game_version}/me.battlehits_2.1.mtmod', 'res_mods/{game_version}/configs/battlehits.json']);
    assert.strictEqual(a.images.length, 1);
    assert.match(a.suggested.description, /попадания/);
    assert.strictEqual(a.suggested.name, 'BattleHits');
    assert.strictEqual(a.suggested.version, '2.1');
  } finally {
    importer.cleanup(a);
  }
  assert.ok(!fs.existsSync(a.staging));
});

test('архив с ../ отклоняется', () => {
  const root = tmpDir();
  const zipPath = path.join(root, 'evil.zip');
  const zip = new AdmZip();
  zip.addFile('ok.mtmod', Buffer.from('x'));
  zip.writeZip(zipPath);
  // adm-zip нормализует имена при addFile, поэтому подменяем имя в готовом архиве
  const buf = fs.readFileSync(zipPath);
  fs.writeFileSync(zipPath, Buffer.from(buf.toString('binary').replaceAll('ok.mtmod', '../evilx'), 'binary'));
  assert.throws(() => importer.analyze(zipPath));
});

test('проект: создание, моды, группы «один из», проверка и уборка', () => {
  const dir = path.join(tmpDir(), 'Проект');
  const p = project.create(dir, { name: 'Тест' });
  assert.throws(() => project.create(dir, {}), /уже есть/);
  assert.ok(project.validate(dir, p).errors.some((e) => /нет ни одного мода/.test(e)));

  const a = importer.analyze(sampleZip(tmpDir()));
  const m1 = { id: 'm1', type: 'mod', name: 'A', checked: true, files: project.storeModFiles(dir, 'm1', a) };
  const m2 = { id: 'm2', type: 'mod', name: 'B', checked: true, files: project.storeModFiles(dir, 'm2', a) };
  m1.preview = project.storeImage(dir, a.images[0]);
  importer.cleanup(a);
  p.tree = [{ id: 'g1', type: 'group', name: 'Прицелы', mode: 'single', children: [m1, m2] }];
  project.save(dir, p);

  const p2 = project.open(dir);
  const [g] = p2.tree;
  assert.deepStrictEqual(g.children.map((c) => c.checked), [true, false], 'в группе «один из» выбран один вариант');
  const v = project.validate(dir, p2);
  assert.deepStrictEqual(v.errors, []);
  assert.ok(!v.warnings.some((w) => /пишут один файл/.test(w)), 'варианты одной группы «один из» не конфликтуют');

  g.mode = 'multi';
  assert.ok(project.validate(dir, p2).warnings.some((w) => /пишут один файл/.test(w)));

  fs.rmSync(path.join(dir, m2.files[0].src));
  assert.ok(project.validate(dir, p2).errors.some((e) => /пропали файлы/.test(e)));

  g.children = [g.children[1]];
  project.collectGarbage(dir, p2);
  assert.ok(!fs.existsSync(path.join(dir, 'mods', 'm1')));
  assert.ok(!fs.existsSync(path.join(dir, m1.preview)));
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'm2')));
});

test('строки Паскаля экранируются', () => {
  assert.strictEqual(inno.pas("It's"), "'It''s'");
  assert.strictEqual(inno.pas('a\nb'), "'a' + #13#10 + 'b'");
  assert.strictEqual(inno.pas(''), "''");
});

test('установщик собирается, ставит выбор по умолчанию и удаляется', { skip: !inno.findIscc() }, async () => {
  const root = tmpDir();
  const dir = path.join(root, 'demo');
  const p = createDemo(dir, DEMO_CATALOG);
  p.options.compression = 'fast';
  const { issPath, exePath } = inno.buildIss(dir, p, {});
  await inno.compileIss(issPath);
  assert.ok(fs.existsSync(exePath));

  const game = makeFakeGame(path.join(root, 'g'), 'v.1.30.1 #77');
  const rm = path.join(game, 'res_mods/1.30.1.0/modpack_demo');
  fs.mkdirSync(path.join(game, 'mods/1.30.1.0'), { recursive: true });
  fs.writeFileSync(path.join(game, 'mods/1.30.1.0/old.mtmod'), 'старый мод');
  execFileSync(exePath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/CURRENTUSER', `/DIR=${game}`]);

  assert.ok(fs.existsSync(path.join(rm, 'demo_sight_classic.txt')), 'первый прицел группы «один из»');
  assert.ok(!fs.existsSync(path.join(rm, 'demo_sight_tactic.txt')), 'второй прицел не ставится');
  assert.ok(fs.existsSync(path.join(rm, 'lamp.ini')));
  assert.ok(!fs.existsSync(path.join(rm, 'demo_hangar.txt')), 'выключенный по умолчанию мод не ставится');
  assert.ok(!fs.existsSync(path.join(game, 'mods/1.30.1.0/old.mtmod')), 'старые моды убраны');
  const backups = fs.readdirSync(path.join(game, 'modpack_backup'));
  assert.ok(fs.existsSync(path.join(game, 'modpack_backup', backups[0], 'mods/1.30.1.0/old.mtmod')), 'и сохранены в бэкап');

  const unins = path.join(game, 'modpack_uninstall', 'Демо-модпак', 'unins000.exe');
  execFileSync(unins, ['/VERYSILENT', '/SUPPRESSMSGBOXES']);
  for (let i = 0; i < 40 && fs.existsSync(path.join(rm, 'lamp.ini')); i++) await new Promise((r) => setTimeout(r, 250));
  assert.ok(!fs.existsSync(path.join(rm, 'lamp.ini')));
});

test('готовые дизайны: разное число экранов, кнопки ведут на существующие экраны', () => {
  const { designs } = require('../src/core/designs');
  const { normalizeLayout } = require('../src/core/layout');
  const list = designs();
  assert.ok(list.length >= 8);
  assert.ok(new Set(list.map((d) => d.screens)).size >= 3, 'дизайны отличаются числом экранов');
  for (const d of list) {
    assert.ok(d.colors && d.colors.accent, d.id);
    const L = normalizeLayout(JSON.parse(JSON.stringify(d.layout)));
    for (const k of Object.keys(d.layout.screens)) assert.ok(L.screens[k], `${d.id}: экран ${k} пропал при нормализации`);
    for (const sc of Object.values(L.screens)) {
      for (const e of sc.elements) {
        if (e.type === 'button' && e.props.action.startsWith('go:')) assert.ok(L.screens[e.props.action.slice(3)], `${d.id}: ${e.props.action}`);
      }
    }
  }
});
