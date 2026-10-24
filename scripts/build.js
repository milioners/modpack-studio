// Сборка установщика программы: упаковка Electron → установщик Inno Setup.
// Запуск: npm run dist   (результат: dist/TankAir-Studio-Setup-<версия>.exe)
// DIST_DIR=<папка> — собрать в другую папку.
'use strict';

const fs = require('fs');
const path = require('path');
const { packager } = require('@electron/packager');
const { findIscc, compileIss } = require('../src/core/inno');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const DIST = path.resolve(process.env.DIST_DIR || path.join(ROOT, 'dist'));
const APP_ID = '7B3E9C52-4A1D-4F8B-9E26-5D0C1A7F3B91';

async function main() {
  const iscc = findIscc();
  if (!iscc) throw new Error('Inno Setup 6 не найден: winget install JRSoftware.InnoSetup');
  // установщики прошлых версий не трогаем — их могут ещё публиковать; чистим только промежуточную упаковку
  fs.mkdirSync(DIST, { recursive: true });
  try {
    fs.rmSync(path.join(DIST, 'pack'), { recursive: true, force: true });
  } catch {
    console.log('   Не удалось очистить dist/pack (файлы заняты) — упаковка перезапишет их');
  }

  console.log('1/2 Упаковка Electron…');
  // Если архив Electron уже скачивался — берём его из кэша, сеть не нужна
  const electronVersion = require('electron/package.json').version;
  const zipName = `electron-v${electronVersion}-win32-x64.zip`;
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  let electronZipDir;
  if (fs.existsSync(cacheRoot)) {
    for (const d of fs.readdirSync(cacheRoot)) {
      if (fs.existsSync(path.join(cacheRoot, d, zipName))) electronZipDir = path.join(cacheRoot, d);
    }
  }
  if (electronZipDir) console.log(`   Electron ${electronVersion} из кэша`);
  const [appDir] = await packager({
    electronZipDir,
    dir: ROOT,
    out: path.join(DIST, 'pack'),
    name: pkg.productName,
    executableName: pkg.productName,
    platform: 'win32',
    arch: 'x64',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    overwrite: true,
    prune: true,
    asar: false, // Inno Setup при сборке модпаков читает файлы каталога напрямую
    ignore: [/^\/(tests|scripts|dist|installer|catalog-online|screenshots|docs|design-refs)(\/|$)/, /^\/CHANGELOG\.md$/, /^\/build\/icon\.png$/, /\.md$/, /^\/catalog\/catalog\.json\.tmp$/],
    appCopyright: `© ${new Date().getFullYear()} ${pkg.author}`,
    win32metadata: {
      CompanyName: pkg.author,
      FileDescription: pkg.description,
      ProductName: pkg.productName,
      InternalName: pkg.productName,
    },
  });
  console.log(`   → ${appDir}`);

  console.log('2/2 Сборка установщика Inno Setup…');
  const exeName = `${pkg.productName}.exe`;
  const iss = `; Установщик TankAir Studio — сгенерирован scripts/build.js
[Setup]
AppId={{${APP_ID}}
AppName=${pkg.productName}
AppVersion=${pkg.version}
AppVerName=${pkg.productName} ${pkg.version}
AppPublisher=${pkg.author}
VersionInfoVersion=${pkg.version}
VersionInfoDescription=${pkg.productName} — установщик
DefaultDirName={autopf}\\${pkg.productName}
DefaultGroupName=${pkg.productName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=${DIST}
OutputBaseFilename=TankAir-Studio-Setup-${pkg.version}
SetupIconFile=${path.join(ROOT, 'build', 'icon.ico')}
UninstallDisplayIcon={app}\\${exeName}
UninstallDisplayName=${pkg.productName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "${appDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; до 1.4 программа называлась ModPack Studio — убираем старый exe и ярлыки при обновлении
[InstallDelete]
Type: files; Name: "{app}\\ModPack Studio.exe"
Type: filesandordirs; Name: "{autoprograms}\\ModPack Studio"
Type: files; Name: "{autodesktop}\\ModPack Studio.lnk"

[Icons]
Name: "{group}\\${pkg.productName}"; Filename: "{app}\\${exeName}"
Name: "{group}\\{cm:UninstallProgram,${pkg.productName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\\${pkg.productName}"; Filename: "{app}\\${exeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\\${exeName}"; Description: "{cm:LaunchProgram,${pkg.productName}}"; Flags: nowait postinstall skipifsilent
; после тихого автообновления программа запускается снова
Filename: "{app}\\${exeName}"; Flags: nowait runasoriginaluser; Check: WizardSilent
`;
  const issPath = path.join(DIST, 'TankAir-Studio.iss');
  fs.writeFileSync(issPath, '﻿' + iss, 'utf8');
  await compileIss(issPath, () => {}, iscc);
  const setup = path.join(DIST, `TankAir-Studio-Setup-${pkg.version}.exe`);
  console.log(`Готово: ${setup} (${(fs.statSync(setup).size / 1024 / 1024).toFixed(1)} МБ)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
