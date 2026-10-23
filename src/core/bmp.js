// Запись 24-битного BMP из RGBA — Inno Setup показывает картинки только в BMP.
'use strict';

const fs = require('fs');

function writeBmp(file, width, height, rgba) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowSize * height;
  const buf = Buffer.alloc(54 + dataSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(dataSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize; // BMP хранится снизу вверх
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = row + x * 3;
      buf[o] = rgba[i + 2];
      buf[o + 1] = rgba[i + 1];
      buf[o + 2] = rgba[i];
    }
  }
  fs.writeFileSync(file, buf);
}

module.exports = { writeBmp };
