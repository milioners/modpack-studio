// Мост между интерфейсом и главным процессом: только перечисленные вызовы, без доступа к Node.
'use strict';

const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  getState: call('state:get'),
  setZoom: (factor) => webFrame.setZoomFactor(factor),
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
  installerSnapshot: call('installer:snapshot'),
  layoutMeta: call('layout:meta'),
  layoutTemplate: call('layout:template'),
  layoutDesigns: call('layout:designs'),
  pickMedia: call('media:pick'),
  mediaUrl: call('media:url'),
  exportDesign: call('design:export'),
  importDesign: call('design:import'),
  installerPreview: call('installer:preview'),
  publishGithub: call('publish:github'),

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

  ws: {
    state: call('ws:state'), running: call('ws:running'), pickGame: call('ws:pickGame'), pickRoot: call('ws:pickRoot'),
    templates: call('ws:templates'), create: call('ws:create'), mod: call('ws:mod'), update: call('ws:update'), remove: call('ws:delete'),
    tree: call('ws:tree'), read: call('ws:read'), write: call('ws:write'), build: call('ws:build'), install: call('ws:install'),
    launch: call('ws:launch'), kill: call('ws:kill'), log: call('ws:log'), shots: call('ws:shots'), addToModpack: call('ws:addToModpack'),
    preview: call('ws:preview'),
    onStep: (fn) => ipcRenderer.on('ws:step', (_e, p) => fn(p)),
  },
  ref: {
    status: call('ref:status'), build: call('ref:build'), search: call('ref:search'), detail: call('ref:detail'), snippet: call('ref:snippet'),
    onProgress: (fn) => ipcRenderer.on('ref:progress', (_e, m) => fn(m)),
  },

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
