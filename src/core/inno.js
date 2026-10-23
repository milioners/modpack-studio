// Генерация и компиляция установщика модпака (Inno Setup 6).
//
// Установщик — как у известных модпаков: баннер автора, своя страница с деревом модов
// (галочки, группы «выбери один вариант»), справа превью, описание и автор выбранного мода.
// Версию игры установщик берёт из version.xml в выбранной папке и подставляет в пути.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { walk, changelogText } = require('./project');

const WIZARD_SIZE = 150; // WizardSizePercent: окно в полтора раза больше стандартного

function findIscc() {
  const cands = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

// Значение для секций [Setup]/[Files]: двойные кавычки удваиваются, { экранируется как {{
const issStr = (s) => String(s).replace(/"/g, '""').replace(/\{/g, '{{');
// Значение для [Messages]: %n — перевод строки
const msgStr = (s) => String(s).replace(/%/g, '%%').replace(/\r?\n/g, '%n');

// Строка Паскаля: кавычки удваиваются, переводы строк — #13#10, длинные строки режутся на куски
function pas(s) {
  const parts = [];
  String(s ?? '').replace(/\r/g, '').split('\n').forEach((line, i) => {
    if (i) parts.push('#13#10');
    for (let j = 0; j < line.length; j += 120) parts.push(`'${line.slice(j, j + 120).replace(/'/g, "''")}'`);
  });
  return parts.length ? parts.join(' + ') : "''";
}

function safeName(s) {
  return String(s).replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'modpack';
}

function fmtSize(bytes) {
  const kb = Math.max(1, Math.round(bytes / 1024));
  return kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} МБ` : `${kb} КБ`;
}

const destPath = (dst) => dst.split('{game_version}').map((p) => p.replace(/\{/g, '{{')).join('{code:GameVersion}')
  .replace(/\//g, '\\');

// Плоский список пунктов дерева в порядке показа (пустые группы пропускаются)
function flatten(project) {
  const items = [];
  const visit = (nodes, level, parentIdx, parentGroup) => {
    let radioChecked = false;
    const firstChecked = parentGroup?.mode === 'single'
      ? (nodes.find((n) => n.type === 'mod' && n.checked) || nodes.find((n) => n.type === 'mod'))
      : null;
    for (const n of nodes) {
      if (n.type === 'group' && ![...walk(n.children)].some((x) => x.node.type === 'mod')) continue;
      const idx = items.length;
      const radio = parentGroup?.mode === 'single' && n.type === 'mod';
      let checked = n.checked;
      if (radio) {
        checked = n === firstChecked && !radioChecked;
        if (checked) radioChecked = true;
      }
      const size = n.type === 'mod' ? n.files.reduce((s, f) => s + (f.size || 0), 0) : 0;
      items.push({ node: n, idx, level, parentIdx, radio, checked, size });
      if (n.type === 'group') visit(n.children, level + 1, idx, n);
    }
  };
  visit(project.tree, 0, -1, null);
  return items;
}

const PASCAL_COMMON = String.raw`
function ParseGameVersion(S: String): String;
var
  P, I, Dots: Integer;
  R: String;
begin
  Result := '';
  P := Pos('<version>', S);
  if P > 0 then S := Copy(S, P + 9, Length(S));
  P := Pos('v.', S);
  if P = 0 then Exit;
  I := P + 2;
  while (I <= Length(S)) and (S[I] = ' ') do I := I + 1;
  R := '';
  while (I <= Length(S)) and (((S[I] >= '0') and (S[I] <= '9')) or (S[I] = '.')) do
  begin
    R := R + S[I];
    I := I + 1;
  end;
  while (Length(R) > 0) and (R[Length(R)] = '.') do Delete(R, Length(R), 1);
  Dots := 0;
  for I := 1 to Length(R) do
    if R[I] = '.' then Dots := Dots + 1;
  while Dots < 3 do
  begin
    R := R + '.0';
    Dots := Dots + 1;
  end;
  Result := R;
end;

function ReadGameVersion(Dir: String): String;
var
  S: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(AddBackslash(Dir) + 'version.xml', S) then
    Result := ParseGameVersion(String(S));
end;

function GameVersion(Param: String): String;
begin
  if CachedVersion = '' then
    CachedVersion := ReadGameVersion(ExpandConstant('{app}'));
  Result := CachedVersion;
end;

function GameExe(Param: String): String;
begin
  Result := ExpandConstant('{app}\WorldOfTanks.exe');
  if not FileExists(Result) then Result := ExpandConstant('{app}\Tanki.exe');
end;

function GameExeExists: Boolean;
begin
  Result := FileExists(GameExe(''));
end;

function GetDefaultDir(Param: String): String;
var
  Drives, Subs: TArrayOfString;
  D, S: Integer;
  Cand: String;
begin
  SetArrayLength(Drives, 5);
  Drives[0] := 'C:'; Drives[1] := 'D:'; Drives[2] := 'E:'; Drives[3] := 'F:'; Drives[4] := 'G:';
  SetArrayLength(Subs, 5);
  Subs[0] := '\Games\Tanki'; Subs[1] := '\Games\World_of_Tanks_RU';
  Subs[2] := '\Games\Mir_Tankov'; Subs[3] := '\Tanki'; Subs[4] := '\Lesta\Tanki';
  for D := 0 to GetArrayLength(Drives) - 1 do
    for S := 0 to GetArrayLength(Subs) - 1 do
    begin
      Cand := Drives[D] + Subs[S];
      if FileExists(Cand + '\version.xml') then
      begin
        Result := Cand;
        Exit;
      end;
    end;
  Result := 'C:\Games\Tanki';
end;

function IsSel(I: Integer): Boolean;
var
  P: Integer;
begin
  Result := L.Checked[I];
  P := ItemParent[I];
  while Result and (P >= 0) do
  begin
    if not L.Checked[P] then Result := False;
    P := ItemParent[P];
  end;
end;

function ModSel(Id: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 0 to GetArrayLength(ItemId) - 1 do
    if ItemId[I] = Id then
    begin
      Result := IsSel(I);
      Exit;
    end;
end;

function FmtKB(KB: Integer): String;
begin
  if KB >= 1024 then
    Result := IntToStr(KB div 1024) + ',' + IntToStr((KB mod 1024) * 10 div 1024) + ' МБ'
  else
    Result := IntToStr(KB) + ' КБ';
end;

function SelectedIds: String;
var
  I: Integer;
begin
  Result := ',';
  for I := 0 to GetArrayLength(ItemKind) - 1 do
    if (ItemKind[I] = 1) and IsSel(I) then Result := Result + ItemId[I] + ',';
end;

procedure UpdateSum;
var
  I, N, KB: Integer;
begin
  N := 0;
  KB := 0;
  for I := 0 to GetArrayLength(ItemKind) - 1 do
    if (ItemKind[I] = 1) and IsSel(I) then
    begin
      N := N + 1;
      KB := KB + ItemSize[I];
    end;
  SumLbl.Caption := 'Выбрано модов: ' + IntToStr(N) + '   •   ' + FmtKB(KB);
end;

procedure ShowImage(F: String);
begin
  if F = '' then
    PrevImg.Visible := False
  else
  begin
    PrevImg.Bitmap.LoadFromFile(ExpandConstant('{tmp}\') + F);
    PrevImg.Visible := True;
  end;
end;

procedure LayoutInfo;
begin
  MetaLbl.Top := TitleLbl.Top + TitleLbl.Height + ScaleY(3);
  DescMemo.Top := MetaLbl.Top + MetaLbl.Height + ScaleY(8);
  DescMemo.Height := ModsPage.SurfaceHeight - DescMemo.Top;
end;

procedure ShowInfo(I: Integer);
begin
  if (I < 0) or (I >= GetArrayLength(ItemKind)) then
  begin
    TitleLbl.Caption := PackTitle;
    MetaLbl.Caption := PackMeta;
    DescMemo.Text := PackDesc;
    ShowImage(PackImg);
  end
  else
  begin
    TitleLbl.Caption := ItemTitle[I];
    MetaLbl.Caption := ItemMeta[I];
    DescMemo.Text := ItemDesc[I];
    if ItemImg[I] <> '' then ShowImage(ItemImg[I]) else ShowImage(PackImg);
  end;
  LayoutInfo;
end;

procedure ListClick(Sender: TObject);
begin
  ShowInfo(L.ItemIndex);
end;

procedure ListClickCheck(Sender: TObject);
begin
  ShowInfo(L.ItemIndex);
  UpdateSum;
end;

procedure RestoreSelection(Prev: String);
var
  I, J: Integer;
  Any: Boolean;
begin
  if Prev = '' then Exit;
  for I := 0 to GetArrayLength(ItemKind) - 1 do
    if ItemKind[I] = 0 then
    begin
      Any := False;
      for J := I + 1 to GetArrayLength(ItemKind) - 1 do
      begin
        if (ItemKind[J] = 1) and (Pos(',' + ItemId[J] + ',', Prev) > 0) then
        begin
          // мод J — потомок группы I?
          Any := Any or (ItemParent[J] = I) or ((ItemParent[J] >= 0) and (ItemParent[ItemParent[J]] = I));
        end;
      end;
      if not Any then L.CheckItem(I, coUncheck);
    end;
  for I := 0 to GetArrayLength(ItemKind) - 1 do
    if ItemKind[I] = 1 then
    begin
      if Pos(',' + ItemId[I] + ',', Prev) > 0 then
        L.CheckItem(I, coCheck)
      else if not ItemRadio[I] then
        L.CheckItem(I, coUncheck);
    end;
end;

procedure DefaultsClick(Sender: TObject);
begin
  RestoreSelection(DefaultIds);
  UpdateSum;
end;

procedure CreateModsPage;
var
  W, H, ListW, X, RW, IH: Integer;
  DefBtn: TNewButton;
begin
  ModsPage := CreateCustomPage(wpSelectDir, 'Выбор модов', 'Отметьте моды, которые нужно установить. Нажмите на мод, чтобы увидеть описание.');
  W := ModsPage.SurfaceWidth;
  H := ModsPage.SurfaceHeight;
  ListW := W * 50 div 100;

  L := TNewCheckListBox.Create(ModsPage);
  L.Parent := ModsPage.Surface;
  L.Left := 0;
  L.Top := 0;
  L.Width := ListW;
  L.Height := H - ScaleY(58);
  L.Flat := True;
  L.Offset := ScaleX(2);
  L.OnClick := @ListClick;
  L.OnClickCheck := @ListClickCheck;

  SumLbl := TNewStaticText.Create(ModsPage);
  SumLbl.Parent := ModsPage.Surface;
  SumLbl.Left := 0;
  SumLbl.Top := L.Top + L.Height + ScaleY(8);
  SumLbl.Font.Style := [fsBold];

  DefBtn := TNewButton.Create(ModsPage);
  DefBtn.Parent := ModsPage.Surface;
  DefBtn.Width := ScaleX(110);
  DefBtn.Height := ScaleY(23);
  DefBtn.Left := ListW - DefBtn.Width;
  DefBtn.Top := L.Top + L.Height + ScaleY(4);
  DefBtn.Caption := 'По умолчанию';
  DefBtn.OnClick := @DefaultsClick;

  CleanBox := TNewCheckBox.Create(ModsPage);
  CleanBox.Parent := ModsPage.Surface;
  CleanBox.Left := 0;
  CleanBox.Top := H - ScaleY(20);
  CleanBox.Width := ListW;
  CleanBox.Height := ScaleY(18);
  CleanBox.Caption := 'Убрать старые моды (сохранятся в modpack_backup)';
  CleanBox.Checked := CleanDefault;

  X := ListW + ScaleX(16);
  RW := W - X;
  IH := RW * 9 div 16;
  PrevImg := TBitmapImage.Create(ModsPage);
  PrevImg.Parent := ModsPage.Surface;
  PrevImg.Left := X;
  PrevImg.Top := 0;
  PrevImg.Width := RW;
  PrevImg.Height := IH;
  PrevImg.Stretch := True;

  TitleLbl := TNewStaticText.Create(ModsPage);
  TitleLbl.Parent := ModsPage.Surface;
  TitleLbl.Left := X;
  TitleLbl.Top := IH + ScaleY(10);
  TitleLbl.AutoSize := False;
  TitleLbl.WordWrap := True;
  TitleLbl.Width := RW;
  TitleLbl.Height := ScaleY(36);
  TitleLbl.Font.Size := 11;
  TitleLbl.Font.Style := [fsBold];
  TitleLbl.AutoSize := True;

  MetaLbl := TNewStaticText.Create(ModsPage);
  MetaLbl.Parent := ModsPage.Surface;
  MetaLbl.Left := X;
  MetaLbl.Width := RW;
  MetaLbl.Font.Color := clGrayText;

  DescMemo := TNewMemo.Create(ModsPage);
  DescMemo.Parent := ModsPage.Surface;
  DescMemo.Left := X;
  DescMemo.Width := RW;
  DescMemo.ReadOnly := True;
  DescMemo.ScrollBars := ssVertical;
  DescMemo.BorderStyle := bsNone;
  DescMemo.Color := ModsPage.Surface.Color;
  DescMemo.WantReturns := False;

  BuildList;
  RestoreSelection(GetPreviousData('Mods', ''));
  L.ItemIndex := -1;
  ShowInfo(-1);
  UpdateSum;
end;

procedure CreateBanner;
var
  B: TBitmapImage;
begin
  if BannerFile = '' then Exit;
  B := TBitmapImage.Create(WizardForm);
  B.Parent := WizardForm.MainPanel;
  B.Align := alClient;
  B.Stretch := True;
  B.Bitmap.LoadFromFile(ExpandConstant('{tmp}\') + BannerFile);
  WizardForm.PageNameLabel.Visible := False;
  WizardForm.PageDescriptionLabel.Visible := False;
  WizardForm.WizardSmallBitmapImage.Visible := False;

  BannerPage := TLabel.Create(WizardForm);
  BannerPage.Parent := WizardForm.MainPanel;
  BannerPage.Transparent := True;
  BannerPage.AutoSize := False;
  BannerPage.Alignment := taRightJustify;
  BannerPage.Width := WizardForm.MainPanel.Width * 45 div 100;
  BannerPage.Left := WizardForm.MainPanel.Width - BannerPage.Width - ScaleX(18);
  BannerPage.Top := (WizardForm.MainPanel.Height - ScaleY(18)) div 2;
  BannerPage.Height := ScaleY(20);
  BannerPage.Font.Color := clWhite;
  BannerPage.Font.Size := 10;
  BannerPage.Font.Style := [fsBold];
end;

procedure InitializeWizard;
begin
  ExtractImages;
  CreateBanner;
  CreateModsPage;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'Mods', SelectedIds);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  I, N: Integer;
begin
  Result := True;
  Log('Далее на странице: ' + IntToStr(CurPageID));
  if CurPageID = wpSelectDir then
  begin
    CachedVersion := ReadGameVersion(WizardDirValue);
    if CachedVersion = '' then
    begin
      MsgBox('В этой папке не найден клиент «Мира танков» (нет файла version.xml).' + #13#10 +
             'Укажите папку, где установлена игра.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (PackGameVersion <> '') and (Pos(PackGameVersion, CachedVersion) <> 1) then
      Result := MsgBox('Модпак собран для версии игры ' + PackGameVersion + ', а у вас ' + CachedVersion + '.' + #13#10 +
                       'Моды могут не работать. Всё равно продолжить?', mbConfirmation, MB_YESNO) = IDYES;
    ModsPage.Description := 'Версия игры: ' + CachedVersion + '. Нажмите на мод, чтобы увидеть описание и превью.';
  end
  else if (ModsPage <> nil) and (CurPageID = ModsPage.ID) then
  begin
    N := 0;
    for I := 0 to GetArrayLength(ItemKind) - 1 do
      if (ItemKind[I] = 1) and IsSel(I) then N := N + 1;
    if N = 0 then
    begin
      MsgBox('Не выбрано ни одного мода.', mbInformation, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  Log('Страница: ' + IntToStr(CurPageID));
  if BannerPage <> nil then BannerPage.Caption := WizardForm.PageNameLabel.Caption;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  I: Integer;
begin
  Result := 'Папка игры:' + NewLine + Space + ExpandConstant('{app}') + NewLine + NewLine + 'Версия игры:' + NewLine + Space + GameVersion('') + NewLine + NewLine + 'Моды:' + NewLine;
  for I := 0 to GetArrayLength(ItemKind) - 1 do
    if (ItemKind[I] = 1) and IsSel(I) then Result := Result + Space + ItemTitle[I] + NewLine;
  if CleanBox.Checked then
    Result := Result + NewLine + 'Старые моды будут перенесены в modpack_backup.' + NewLine;
end;

procedure BackupOld(Sub: String);
var
  Src, Dst: String;
begin
  Src := ExpandConstant('{app}\') + Sub + '\' + GameVersion('');
  if not DirExists(Src) then Exit;
  Dst := ExpandConstant('{app}\modpack_backup\') + GetDateTimeString('yyyy-mm-dd_hh-nn-ss', '-', '-') + '\' + Sub;
  ForceDirectories(Dst);
  if RenameFile(Src, Dst + '\' + GameVersion('')) then
    Log('Старые моды перенесены: ' + Src + ' -> ' + Dst)
  else
    Log('Не удалось перенести ' + Src);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssInstall) and CleanBox.Checked then
  begin
    BackupOld('mods');
    BackupOld('res_mods');
  end;
end;
`;

// assets: { banner, sidebar, icon, packImage, previews: { [nodeId]: путь к .bmp } }
// opts: { outDir }
function buildIss(projectDir, project, assets = {}, opts = {}) {
  const info = project.info;
  const items = flatten(project);
  const mods = items.filter((i) => i.node.type === 'mod');
  if (!mods.length) throw new Error('В модпаке нет ни одного мода');

  const outDir = path.resolve(opts.outDir || project.options.outputDir || path.join(projectDir, 'output'));
  fs.mkdirSync(outDir, { recursive: true });
  const base = safeName(info.name);
  const exeBase = `${base}_${safeName(info.version || '1.0')}`;
  const previews = assets.previews || {};

  // Картинки упаковываются в установщик и распаковываются во временную папку при запуске
  const images = new Map(); // путь -> имя внутри установщика
  const imgName = (p, prefix) => {
    if (!p || !fs.existsSync(p)) return '';
    if (!images.has(p)) images.set(p, `${prefix}${images.size}.bmp`);
    return images.get(p);
  };
  const bannerName = imgName(assets.banner, 'banner');
  const packImgName = imgName(assets.packImage, 'pack');

  const meta = (n, size) => [n.type === 'mod' && n.version ? `Версия ${n.version}` : '', n.author ? `Автор: ${n.author}` : '',
    n.type === 'mod' ? fmtSize(size) : ''].filter(Boolean).join('   •   ');

  const listLines = items.map((it) => {
    const n = it.node;
    const kind = n.type === 'group' ? 0 : 1;
    const sub = n.type === 'mod' ? fmtSize(it.size) : '';
    const call = n.type === 'group'
      ? `L.AddCheckBox(${pas(n.name)}, '', ${it.level}, ${it.checked}, True, True, True, nil)`
      : it.radio
        ? `L.AddRadioButton(${pas(n.name)}, ${pas(sub)}, ${it.level}, ${it.checked}, True, nil)`
        : `L.AddCheckBox(${pas(n.name)}, ${pas(sub)}, ${it.level}, ${it.checked}, True, False, True, nil)`;
    const groupHint = n.type === 'group'
      ? (n.mode === 'single' ? 'Группа: можно выбрать один вариант.' : 'Группа модов.') : '';
    const desc = n.description || groupHint || 'Описание не указано.';
    return `  I := ${call};\n  ItemRadio[I] := ${it.radio};\n  SetItem(I, ${kind}, ${it.parentIdx}, ${Math.ceil(it.size / 1024)}, '${n.id}', ${pas(n.name)}, ${pas(meta(n, it.size))}, ${pas(desc)}, '${imgName(previews[n.id], 'p')}');`;
  });
  const defaultIds = `,${items.filter((i) => i.node.type === 'mod' && i.checked).map((i) => i.node.id).join(',')},`;

  const files = [];
  for (const it of mods) {
    for (const f of it.node.files) {
      const src = path.resolve(projectDir, f.src);
      const d = destPath(f.dst);
      const cut = d.lastIndexOf('\\');
      files.push(`Source: "${issStr(src)}"; DestDir: "{app}\\${d.slice(0, cut)}"; DestName: "${issStr(d.slice(cut + 1))}"; `
        + `Flags: ignoreversion; Check: ModSel('${it.node.id}')`);
    }
  }
  const imageFiles = [...images].map(([p, name]) => {
    const tmp = path.join(outDir, '.build', name);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.copyFileSync(p, tmp);
    return `Source: "${issStr(tmp)}"; Flags: dontcopy`;
  });

  // «Что нового»: отдельная страница перед выбором папки (InfoBefore)
  let infoBefore = '';
  const notes = project.options.showChangelog ? changelogText(project) : '';
  if (notes) {
    infoBefore = path.join(outDir, '.build', 'changelog.txt');
    fs.mkdirSync(path.dirname(infoBefore), { recursive: true });
    fs.writeFileSync(infoBefore, `﻿${notes.replace(/\r?\n/g, '\r\n')}`, 'utf8');
  }
  const theme = { dark: 'modern dark', auto: 'modern dynamic' }[project.design.theme] || 'modern';
  const launch = project.options.launchGame
    ? '\n[Run]\nFilename: "{code:GameExe}"; WorkingDir: "{app}"; Description: "Запустить «Мир танков»"; Flags: nowait postinstall skipifsilent; Check: GameExeExists\n'
    : '';

  const d = project.design;
  const welcome = d.welcomeText || `${info.description}\n\nВерсия модпака: ${info.version}${info.author ? `\nАвтор: ${info.author}` : ''}\n\nПеред установкой закройте игру.`;
  const finish = d.finishText || `Модпак «${info.name}» установлен. Можно запускать игру!`;
  const setupLines = [
    `AppId={{${project.appId}}`,
    `AppName=${issStr(info.name)}`,
    `AppVersion=${issStr(info.version)}`,
    `AppVerName=${issStr(info.name)} ${issStr(info.version)}`,
    `AppPublisher=${issStr(info.author || info.name)}`,
    info.website ? `AppPublisherURL=${issStr(info.website)}` : '',
    'DefaultDirName={code:GetDefaultDir}',
    'AppendDefaultDirName=no',
    'DirExistsWarning=no',
    'UsePreviousAppDir=yes',
    'DisableProgramGroupPage=yes',
    'DisableWelcomePage=no',
    'DisableDirPage=no',
    'CreateUninstallRegKey=yes',
    `UninstallFilesDir={app}\\modpack_uninstall\\${issStr(base)}`,
    `UninstallDisplayName=${issStr(info.name)} ${issStr(info.version)} (моды для «Мира танков»)`,
    `OutputDir=${issStr(outDir)}`,
    `OutputBaseFilename=${issStr(exeBase)}`,
    assets.icon && fs.existsSync(assets.icon) ? `SetupIconFile=${issStr(assets.icon)}` : '',
    assets.sidebar && fs.existsSync(assets.sidebar) ? `WizardImageFile=${issStr(assets.sidebar)}` : '',
    `WizardStyle=${theme}`,
    infoBefore ? `InfoBeforeFile=${issStr(infoBefore)}` : '',
    `WizardSizePercent=${WIZARD_SIZE}`,
    project.options.compression === 'fast' ? 'Compression=lzma2/fast' : 'Compression=lzma2/ultra64',
    'SolidCompression=yes',
    'PrivilegesRequired=lowest',
    'PrivilegesRequiredOverridesAllowed=dialog',
    'ShowLanguageDialog=no',
    `VersionInfoDescription=${issStr(info.name)} — установщик модпака`,
  ].filter(Boolean);

  const iss = `; Сгенерировано ModPack Studio. Можно редактировать вручную.
[Setup]
${setupLines.join('\n')}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"

[Messages]
russian.WelcomeLabel1=${msgStr(`Установка модпака «${info.name}»`)}
russian.WelcomeLabel2=${msgStr(welcome)}
russian.SelectDirLabel3=Выберите папку, где установлен «Мир танков».
russian.SelectDirBrowseLabel=Нажмите «Далее», если папка указана верно, или «Обзор», чтобы выбрать другую.
russian.FinishedHeadingLabel=${msgStr('Готово!')}
russian.FinishedLabelNoIcons=${msgStr(finish)}
russian.FinishedLabel=${msgStr(finish)}
russian.WizardInfoBefore=Что нового
russian.InfoBeforeLabel=${msgStr(`Изменения в модпаке «${info.name}»:`)}
russian.InfoBeforeClickLabel=Нажмите «Далее», чтобы продолжить установку.

[Files]
${imageFiles.join('\n')}
${files.join('\n')}
${launch}
[Code]
const
  PackTitle = ${pas(info.name)};
  PackMeta = ${pas([`Версия ${info.version}`, info.author ? `Автор: ${info.author}` : '', info.gameVersion ? `Для игры ${info.gameVersion}` : ''].filter(Boolean).join('   •   '))};
  PackDesc = ${pas(info.description)};
  PackImg = '${packImgName}';
  PackGameVersion = ${pas(info.gameVersion || '')};
  BannerFile = '${bannerName}';
  DefaultIds = '${defaultIds}';
  CleanDefault = ${Boolean(project.options.cleanDefault)};

var
  CachedVersion: String;
  ModsPage: TWizardPage;
  L: TNewCheckListBox;
  PrevImg: TBitmapImage;
  TitleLbl, MetaLbl, SumLbl: TNewStaticText;
  DescMemo: TNewMemo;
  CleanBox: TNewCheckBox;
  BannerPage: TLabel;
  ItemKind, ItemParent, ItemSize: array of Integer;
  ItemRadio: array of Boolean;
  ItemId, ItemTitle, ItemMeta, ItemDesc, ItemImg: TArrayOfString;

procedure SetItem(I, Kind, Parent, SizeKB: Integer; Id, Title, Meta, Desc, Img: String);
begin
  ItemKind[I] := Kind;
  ItemParent[I] := Parent;
  ItemSize[I] := SizeKB;
  ItemId[I] := Id;
  ItemTitle[I] := Title;
  ItemMeta[I] := Meta;
  ItemDesc[I] := Desc;
  ItemImg[I] := Img;
end;

procedure ExtractImages;
begin
${[...images.values()].map((n) => `  ExtractTemporaryFile('${n}');`).join('\n') || '  // картинок нет'}
end;

procedure BuildList;
var
  I: Integer;
begin
  SetArrayLength(ItemKind, ${items.length});
  SetArrayLength(ItemParent, ${items.length});
  SetArrayLength(ItemSize, ${items.length});
  SetArrayLength(ItemRadio, ${items.length});
  SetArrayLength(ItemId, ${items.length});
  SetArrayLength(ItemTitle, ${items.length});
  SetArrayLength(ItemMeta, ${items.length});
  SetArrayLength(ItemDesc, ${items.length});
  SetArrayLength(ItemImg, ${items.length});
${listLines.join('\n')}
end;
${PASCAL_COMMON}`;
  const issPath = path.join(outDir, `${base}.iss`);
  fs.writeFileSync(issPath, '\ufeff' + iss, 'utf8'); // Inno Setup 6 читает UTF-8 с BOM
  return { issPath, exePath: path.join(outDir, `${exeBase}.exe`), items: items.length, files: files.length };
}

function compileIss(issPath, onLine = () => {}, iscc = findIscc()) {
  return new Promise((resolve, reject) => {
    if (!iscc) {
      reject(new Error('Inno Setup 6 не найден. Установите его с jrsoftware.org или командой: winget install JRSoftware.InnoSetup'));
      return;
    }
    const proc = spawn(iscc, [issPath], { windowsHide: true });
    let out = '';
    const onData = (buf) => {
      const s = buf.toString('utf8');
      out += s;
      s.split(/\r?\n/).filter(Boolean).forEach(onLine);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    proc.on('close', (code) => {
      fs.rmSync(path.join(path.dirname(issPath), '.build'), { recursive: true, force: true });
      if (code === 0) resolve(out);
      else reject(new Error(`Ошибка компиляции Inno Setup (код ${code}):\n${out.slice(-3000)}`));
    });
  });
}

module.exports = { findIscc, buildIss, compileIss, flatten, issStr, safeName, pas, WIZARD_SIZE };
