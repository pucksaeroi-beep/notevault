'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const channels = [
  'lib:info', 'lib:listNotes', 'lib:getNote', 'lib:saveNote', 'lib:deleteNote', 'lib:getFolders', 'lib:saveFolders',
  'lib:saveAsset', 'lib:pickImage', 'lib:chooseFolder', 'lib:resetFolder', 'lib:reveal', 'lib:backup', 'lib:seedSamples',
  'file:saveText', 'file:savePdf', 'file:openText', 'file:openJson',
  'vault:status', 'vault:create', 'vault:unlock', 'vault:unlockTouchId', 'vault:setTouchId', 'vault:lock', 'vault:items',
  'vault:saveItem', 'vault:deleteItem', 'vault:import', 'vault:export', 'vault:changePassword',
  'clip:copy', 'settings:get', 'settings:set', 'theme:set', 'open:external',
];
const api = {};
for (const ch of channels) {
  const [ns, fn] = ch.split(':');
  (api[ns] ||= {})[fn] = call(ch);
}
api.on = (event, cb) => {
  const allowed = ['menu', 'vault:locked'];
  if (!allowed.includes(event)) return () => {};
  const h = (_e, ...a) => cb(...a);
  ipcRenderer.on(event, h);
  return () => ipcRenderer.removeListener(event, h);
};
contextBridge.exposeInMainWorld('nv', api);
