'use strict';
// Собственный установщик модпака: сборка, установка без окна, переустановка, удаление, снимок окна.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { makeFakeGame, tmpDir } = require('./helpers');

const mps = require('../src/core/mpsinstaller');
const { createDemo } = require('../src/core/demo');

const REG = (appId) => `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ModPack_${appId}`;
const regExists = (appId) => {
  try {
    execFileSync('reg', ['query', REG(appId)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('zip пишется в формате, который читают другие программы', () => {
  const dir = tmpDir();
  const big = path.join(dir, 'big.mtmod');
  fs.writeFileSync(big, Buffer.alloc(300000, 7));
  const file = path.join(dir, 'a.zip');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, Buffer.from('PREFIX'));
  const len = mps.writeZip(fd, 6, [
    { name: 'manifest.json', buffer: Buffer.from('{"a":"привет"}'.repeat(20)) },
    { name: 'mods/x/Прицел.mtmod', file: big },
  ]);
  fs.closeSync(fd);
  const zipOnly = fs.readFileSync(file).subarray(6, 6 + len);
  const z = new AdmZip(zipOnly);
  assert.deepStrictEqual(z.getEntries().map((e) => e.entryName), ['manifest.json', 'mods/x/Прицел.mtmod']);
  assert.strictEqual(z.readAsText('manifest.json'), '{"a":"привет"}'.repeat(20));
  assert.strictEqual(z.getEntry('mods/x/Прицел.mtmod').getData().length, 300000);
});

test('свой установщик: установка, переустановка, бэкап, удаление', { skip: !mps.findCsc() }, async () => {
  const root = tmpDir();
  const dir = path.join(root, 'proj');
  const p = createDemo(dir, path.join(__dirname, '..', 'catalog'));
  const stub = await mps.compileStub({ icon: path.join(__dirname, '..', 'build', 'icon.ico'), title: p.info.name, version: p.info.version, company: 'Тест', cacheDir: path.join(root, 'cache') });
  const exe = mps.pack(dir, p, {}, { outFile: path.join(root, 'out', mps.exeName(p)), stub });
  const tail = fs.readFileSync(exe).subarray(-8).toString('ascii');
  assert.strictEqual(tail, 'MPSPACK1');

  const game = makeFakeGame(path.join(root, 'g'), 'v.1.30.1 #77');
  const rm = path.join(game, 'res_mods/1.30.1.0/modpack_demo');
  // чужой файл, который перезапишет модпак, должен вернуться после удаления
  fs.mkdirSync(rm, { recursive: true });
  fs.writeFileSync(path.join(rm, 'lamp.ini'), 'чужая лампа');

  const ids = Object.fromEntries([...require('../src/core/project').walk(p.tree)].map(({ node }) => [node.name, node.id]));
  const sel = [ids['Прицел «Тактик»'], ids['Лампа «Шестое чувство»']].join(',');
  execFileSync(exe, ['--silent', `--dir=${game}`, `--select=${sel}`]);
  assert.ok(fs.existsSync(path.join(rm, 'demo_sight_tactic.txt')));
  assert.ok(!fs.existsSync(path.join(rm, 'demo_sight_classic.txt')));
  assert.notStrictEqual(fs.readFileSync(path.join(rm, 'lamp.ini'), 'utf8'), 'чужая лампа');
  assert.ok(regExists(p.appId), 'модпак виден в «Приложениях» Windows');

  const mdir = path.join(game, 'modpack_uninstall', p.appId);
  const manager = path.join(mdir, 'Управление модпаком.exe');
  assert.ok(fs.existsSync(manager));
  const rec = JSON.parse(fs.readFileSync(path.join(mdir, 'install.json'), 'utf8'));
  assert.strictEqual(rec.selected.length, 2);
  assert.strictEqual(rec.backups.length, 1);

  // переустановка с другим выбором: прошлые файлы убираются
  execFileSync(exe, ['--silent', `--dir=${game}`, `--select=${ids['Прицел «Классика»']}`]);
  assert.ok(fs.existsSync(path.join(rm, 'demo_sight_classic.txt')));
  assert.ok(!fs.existsSync(path.join(rm, 'demo_sight_tactic.txt')));
  assert.strictEqual(fs.readFileSync(path.join(rm, 'lamp.ini'), 'utf8'), 'чужая лампа', 'бэкап возвращён при переустановке');

  // удаление через копию «Управление модпаком»
  execFileSync(manager, ['--silent', '--uninstall', `--dir=${game}`]);
  assert.ok(!fs.existsSync(path.join(rm, 'demo_sight_classic.txt')));
  assert.strictEqual(fs.readFileSync(path.join(rm, 'lamp.ini'), 'utf8'), 'чужая лампа');
  assert.ok(!regExists(p.appId));
  for (let i = 0; i < 20 && fs.existsSync(mdir); i++) await sleep(300);
  assert.ok(!fs.existsSync(mdir), 'папка управления удалена');
});

test('раскладка: шаблоны, нормализация и картинки в установщике', () => {
  const layout = require('../src/core/layout');
  for (const name of Object.keys(layout.TEMPLATES)) {
    const t = layout.template(name);
    assert.deepStrictEqual(Object.keys(t.screens), layout.SCREENS);
    for (const sc of Object.values(t.screens)) for (const e of sc.elements) assert.ok(layout.TYPES[e.type], e.type);
  }
  const n = layout.normalizeLayout({ screens: { welcome: { elements: [{ type: 'text', x: 1.6, w: -5, showIf: 'взлом' }, { type: 'script' }] } } });
  const [el] = n.screens.welcome.elements;
  assert.strictEqual(n.screens.welcome.elements.length, 1, 'неизвестные типы отбрасываются');
  assert.strictEqual(el.x, 2);
  assert.strictEqual(el.w, 8);
  assert.strictEqual(el.showIf, 'always');
  assert.ok(n.screens.mods.elements.length > 0, 'недостающие экраны берутся из шаблона');

  const dir = path.join(tmpDir(), 'proj');
  const p = createDemo(dir, path.join(__dirname, '..', 'catalog'));
  p.installer.layout.screens.welcome.elements.push({ ...n.screens.welcome.elements[0], type: 'image', props: { src: 'images/x.png', fit: 'cover' } });
  p.installer.layout.screens.mods.background.image = 'images/x.png';
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const { manifest, entries } = mps.manifestAndEntries(dir, p, { layoutImages: { 'images/x.png': png } }, false);
  const img = manifest.theme.layout.screens.welcome.elements.find((e) => e.type === 'image' && e.props.src?.startsWith('img/l'));
  assert.ok(img, 'картинка элемента переименована в путь внутри установщика');
  assert.strictEqual(manifest.theme.layout.screens.mods.background.image, img.props.src, 'одна картинка упакована один раз');
  assert.strictEqual(entries.filter((e) => e.name.startsWith('img/l')).length, 1);
});

test('свой установщик: снимок окна без показа на экране', { skip: !mps.findCsc() }, async () => {
  const root = tmpDir();
  const dir = path.join(root, 'proj');
  const p = createDemo(dir, path.join(__dirname, '..', 'catalog'));
  const stub = await mps.compileStub({ title: p.info.name, version: '1.0', company: '', cacheDir: path.join(root, 'cache') });
  const exe = mps.pack(dir, p, {}, { outFile: path.join(root, 'preview.exe'), stub, includeMods: false });
  for (const screen of ['welcome', 'mods', 'finish']) {
    const png = await mps.screenshot(exe, screen, path.join(root, `${screen}.png`));
    const head = fs.readFileSync(png).subarray(0, 8);
    assert.strictEqual(head.toString('hex'), '89504e470d0a1a0a');
    assert.ok(fs.statSync(png).size > 5000);
  }
});
