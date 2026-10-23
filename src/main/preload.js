// Мост между интерфейсом и главным процессом: только перечисленные вызовы, без доступа к Node.
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  getState: call('state:get'),
  newProject: call('project:new'),
  openProject: call('project:open'),
  demoProject: call('project:demo'),
  closeProject: call('project:close'),
  forgetProject: call('project:forget'),
  saveProject: call('project:save'),

  pickMods: call('mods:pick'),
  addMods: call('mods:add'),
  replaceFiles: call('mods:replaceFiles'),

  pickImage: call('image:pick'),
  storeImage: call('image:store'),
  imageData: call('image:data'),
  pickOutput: call('output:pick'),

  build: call('build:run'),
  deleteBuild: call('builds:delete'),

  loadCatalog: call('catalog:load'),
  catalogImage: call('catalog:image'),
  addFromCatalog: call('catalog:add'),
  updateFromCatalog: call('catalog:updateNode'),
  onCatalogProgress: (fn) => ipcRenderer.on('catalog:progress', (_e, p) => fn(p)),

  appSettings: call('app:settings'),
  checkUpdate: call('update:check'),
  downloadUpdate: call('update:download'),
  installUpdate: call('update:install'),
  onUpdateProgress: (fn) => ipcRenderer.on('update:progress', (_e, p) => fn(p)),
  onBuildLog: (fn) => ipcRenderer.on('build:log', (_e, line) => fn(line)),

  openPath: call('shell:open'),
  showItem: call('shell:show'),
  openExternal: call('shell:external'),
  pathKind: call('fs:kind'),

  onOpenFile: (fn) => ipcRenderer.on('open-file', (_e, p) => fn(p)),
  pathForFile: (file) => webUtils.getPathForFile(file),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
  },
});
