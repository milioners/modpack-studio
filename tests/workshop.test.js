'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { makeFakeGame, tmpDir } = require('./helpers');

const workshop = require('../src/core/workshop');
const modbuild = require('../src/core/modbuild');
const templates = require('../src/core/modtemplates');
const gameref = require('../src/core/gameref');

const tools = modbuild.findTools();

test('имена мода: транслит, модуль Python и тег для лога', () => {
  assert.strictEqual(templates.slug('Счётчик сессии'), 'schetchik_sessii');
  assert.strictEqual(templates.slug('2 Hits!'), 'mod_2_hits');
  assert.strictEqual(templates.camel('schetchik_sessii'), 'SchetchikSessii');
  const n = templates.names({ name: 'Мой мод' });
  assert.deepStrictEqual([n.id, n.py, n.tag], ['my.moy_mod', 'moy_mod', 'MoyMod']);
});

test('версия игры из version.xml дополняется до папки mods/<версия>', () => {
  const game = makeFakeGame(tmpDir(), 'v.1.46.0 #42');
  assert.strictEqual(workshop.gameVersion(game), '1.46.0.0');
  const info = workshop.findGame(game);
  assert.strictEqual(info.version, '1.46.0.0');
  assert.ok(info.modsDir.endsWith(path.join('mods', '1.46.0.0')));
});

test('новый мод из каждого шаблона: файлы, workshop.json, meta.xml', () => {
  const root = tmpDir();
  for (const t of templates.TEMPLATES) {
    const dir = workshop.create(root, { template: t.id, name: `Мод ${t.id}`, id: `test.${t.id}`, version: '1.2', author: 'tester' });
    const m = workshop.readMod(dir);
    assert.strictEqual(m.id, `test.${t.id}`);
    assert.strictEqual(m.template, t.id);
    const meta = fs.readFileSync(path.join(dir, 'src', 'meta.xml'), 'utf8');
    assert.match(meta, /<id>test\./);
    assert.match(meta, /<version>1\.2<\/version>/);
    const tree = workshop.tree(dir).map((f) => f.rel);
    if (t.id !== 'files') assert.ok(tree.some((r) => /mod_mod_\w+\.py$/.test(r)), t.id);
    if (t.id === 'hangar') assert.ok(tree.some((r) => r.endsWith('.html')));
    if (t.id === 'battle') assert.ok(tree.some((r) => r.endsWith('UI.hx')));
  }
  assert.throws(() => workshop.create(root, { template: 'blank', name: 'x', id: 'test.blank' }), /уже есть/);
  assert.throws(() => workshop.create(root, { template: 'blank', name: 'x', id: 'плохой id' }), /латиница/);
  assert.strictEqual(workshop.list(root).length, templates.TEMPLATES.length);
});

test('редактор: чтение и запись только внутри папки мода', () => {
  const dir = workshop.create(tmpDir(), { template: 'blank', name: 'Редактор' });
  const rel = workshop.tree(dir).find((f) => f.rel.endsWith('redaktor.py')).rel;
  workshop.writeFile(dir, rel, '# новое\n');
  assert.strictEqual(workshop.readFile(dir, rel), '# новое\n');
  assert.throws(() => workshop.readFile(dir, '../../etc.py'), /вне папки/);
  workshop.update(dir, { version: '2.0', name: 'Новое имя' });
  assert.match(fs.readFileSync(path.join(dir, 'src', 'meta.xml'), 'utf8'), /<version>2\.0<\/version>[\s\S]*<name>Новое имя<\/name>/);
});

test('сборка .mtmod из всех шаблонов и установка в игру', { skip: !tools.python && 'нет Python 2.7' }, async () => {
  const root = tmpDir();
  const game = workshop.gameInfo(makeFakeGame(tmpDir(), 'v.1.46.0 #1'));
  for (const t of templates.TEMPLATES) {
    if (t.id === 'battle' && !tools.haxe) continue;
    const dir = workshop.create(root, { template: t.id, name: `Сборка ${t.id}`, id: `build.${t.id}` });
    const states = [];
    const entry = await modbuild.build(dir, tools, (i, st) => states.push(st));
    assert.ok(!states.includes('fail'), t.id);
    const names = new AdmZip(entry.file).getEntries().map((e) => e.entryName);
    assert.ok(names.includes('meta.xml'));
    assert.ok(!names.some((n) => n.endsWith('.py')), 'исходники .py не попадают в мод');
    if (t.id !== 'files') assert.ok(names.some((n) => n.endsWith('.pyc')), t.id);
    if (t.id === 'battle') assert.ok(names.some((n) => n.endsWith('.swf')));
    const dst = workshop.install(entry.file, game, `build.${t.id}`);
    assert.ok(fs.existsSync(dst));
    assert.strictEqual(workshop.installedVersion(game, `build.${t.id}`), '0.1');
  }
  // новая версия заменяет старую в mods/<версия>
  const dir = path.join(root, 'sborka_blank');
  workshop.update(dir, { version: '0.2' });
  const e2 = await modbuild.build(dir, tools);
  workshop.install(e2.file, game, 'build.blank');
  assert.deepStrictEqual(fs.readdirSync(game.modsDir).filter((f) => f.startsWith('build.blank_')), ['build.blank_0.2.mtmod']);
});

test('ошибка в коде мода — с файлом и строкой', { skip: !tools.python && 'нет Python 2.7' }, async () => {
  const dir = workshop.create(tmpDir(), { template: 'blank', name: 'Ошибка' });
  const rel = workshop.tree(dir).find((f) => f.rel.endsWith('oshibka.py')).rel;
  workshop.writeFile(dir, rel, '# -*- coding: utf-8 -*-\ndef init()\n    pass\n');
  const r = await modbuild.checkFile(tools.python, dir, rel);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].line, 2);
  await assert.rejects(modbuild.build(dir, tools), /строка 2/);
});

test('SWF экрана: класс в спрайте, символ и экземпляр main', () => {
  // минимальный SWF Haxe: FileAttributes + DoABC с телом-заглушкой
  const abc = Buffer.from([1, 0, 0, 0, 0, 0x10, 0, 0x2e, 0]);
  const tag = (code, body) => { const h = Buffer.alloc(6); h.writeUInt16LE((code << 6) | 0x3f); h.writeUInt32LE(body.length, 2); return Buffer.concat([h, body]); };
  const body = Buffer.concat([Buffer.from([0x78, 0, 0x05, 0x5f, 0, 0, 0x0f, 0xa0, 0]), Buffer.from([0, 30, 1, 0]), tag(82, abc), tag(0, Buffer.alloc(0))]);
  const head = Buffer.from('FWS\x0b\0\0\0\0', 'latin1');
  head.writeUInt32LE(8 + body.length, 4);
  const swf = modbuild.packSwf(Buffer.concat([head, body]), 'MyUI');
  const tags = modbuild.swfTags(swf);
  const codes = tags.map((t) => t.code);
  assert.deepStrictEqual(codes, [69, 9, 82, 39, 76, 26, 1, 0]);
  assert.ok(tags.find((t) => t.code === 76).body.includes(Buffer.from('MyUI\0')));
  assert.ok(tags.find((t) => t.code === 26).body.includes(Buffer.from('main\0')));
});

test('лог игры: разбор строк, ошибки и фильтр', () => {
  const game = workshop.gameInfo(makeFakeGame(tmpDir()));
  fs.writeFileSync(game.log, [
    '2026-10-26 10:00:00.100: INFO: [MyMod] запущен',
    '2026-10-26 10:00:01.200: ERROR: [MyMod] Не удалось',
    'Traceback (most recent call last):',
    '2026-10-26 10:00:02.300: WARNING: [Other] предупреждение',
  ].join('\r\n'));
  const all = workshop.logTail(game);
  assert.strictEqual(all.lines.length, 4);
  assert.deepStrictEqual(all.lines.map((l) => l.kind), ['info', 'error', 'error', 'warn']);
  assert.strictEqual(all.lines[0].tag, 'MyMod');
  assert.strictEqual(workshop.logTail(game, { filter: 'mymod' }).lines.length, 2);
});

test('перехват метода из справочника', () => {
  const s = gameref.interceptSnippet('gui.x.Meta', 'Meta', 'as_setDataS', ['self', 'data']);
  assert.match(s.func, /def _on_as_setDataS\(original, self, data, \*\*kwargs\):/);
  assert.match(s.func, /original\(self, data, \*\*kwargs\)/);
  assert.match(s.init, /from gui\.x\.Meta import Meta/);
  assert.match(s.init, /_patch\(Meta, 'as_setDataS', _on_as_setDataS\)/);
});
