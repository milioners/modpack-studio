// Пример проекта: демо-моды из catalog/ разложены по группам, чтобы сразу было что собрать.
// Демо-моды кладут безвредные текстовые файлы в res_mods/<версия>/modpack_demo/.
'use strict';

const fs = require('fs');
const path = require('path');
const project = require('./project');
const importer = require('./importer');
const { readJson } = require('./fsutil');

const LAYOUT = [
  { group: 'Прицелы', mode: 'single', description: 'Выберите один прицел — два сразу работать не будут.', mods: ['demo_sight_classic', 'demo_sight_tactic'] },
  { group: 'Боевой интерфейс', mode: 'multi', description: 'Полезная информация прямо в бою.', mods: ['demo_lamp', 'demo_markers', 'demo_damage', 'demo_minimap'] },
  { mods: ['demo_zoom', 'demo_hangar'] },
];

function createDemo(dir, catalogDir) {
  const p = project.create(dir, {
    name: 'Демо-модпак', version: '1.0', author: 'ModPack Studio',
    description: 'Пример модпака: прицелы на выбор, боевой интерфейс, зум и удобный ангар.\nВсе моды демонстрационные и ничего не меняют в игре.',
  });
  const cat = readJson(path.join(catalogDir, 'catalog.json'));
  const makeMod = (id) => {
    const src = cat.mods.find((m) => m.id === id);
    const node = {
      id: project.newId('m'), type: 'mod', name: src.name.replace(/^Демо: /, ''), version: src.version, author: src.author,
      description: src.description, preview: null, checked: id !== 'demo_hangar', files: [],
    };
    const a = importer.analyze(path.join(catalogDir, 'mods', id, 'files'));
    try {
      // демо-файлы кладём в отдельную папку, чтобы не смешивать с настоящими модами
      a.files = [...a.files, ...a.skipped.map((rel) => ({ rel, size: fs.statSync(path.join(a.root, rel)).size }))]
        .map((f) => ({ ...f, dst: `res_mods/{game_version}/modpack_demo/${f.rel}` }));
      node.files = project.storeModFiles(dir, node.id, a);
    } finally {
      importer.cleanup(a);
    }
    if (src.preview) node.preview = project.storeImage(dir, path.join(catalogDir, 'mods', id, src.preview));
    return node;
  };
  for (const block of LAYOUT) {
    const mods = block.mods.map(makeMod);
    if (block.group) {
      p.tree.push({ id: project.newId('g'), type: 'group', name: block.group, description: block.description, mode: block.mode,
        checked: true, expanded: true, preview: null, children: mods });
    } else {
      p.tree.push(...mods);
    }
  }
  project.save(dir, p);
  return project.open(dir);
}

module.exports = { createDemo };
