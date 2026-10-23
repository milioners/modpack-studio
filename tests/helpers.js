'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeFakeGame(root, version = 'v.1.30.0 #1234') {
  const game = path.join(root, 'Tanki');
  for (const d of ['res', 'mods/1.30.0.0', 'res_mods/1.30.0.0']) fs.mkdirSync(path.join(game, d), { recursive: true });
  fs.writeFileSync(path.join(game, 'WorldOfTanks.exe'), '');
  fs.writeFileSync(path.join(game, 'version.xml'), `<version.xml><version>${version}</version></version.xml>`);
  return game;
}

const tmpDir = (p = 'mps') => fs.mkdtempSync(path.join(os.tmpdir(), p));
module.exports = { makeFakeGame, tmpDir };
