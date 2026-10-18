// The only bridge between the page and the main process. Every call returns a value or throws
// the main process's error message.
const { contextBridge, ipcRenderer } = require('electron')

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

contextBridge.exposeInMainWorld('rh', {
  platform: process.platform,
  getSettings: () => call('settings:get'),
  setSettings: (patch, secrets) => call('settings:set', patch, secrets),
  listModels: (backend) => call('models:list', backend),
  complete: (prompt, schema) => call('ai:complete', prompt, schema),
  search: (query) => call('search:web', query),
  news: (query) => call('search:news', query),
  openSettings: () => call('settings:open'),
  setMenuState: (state) => call('menu:state', state),
  onMenu: (fn) => { const h = (_e, cmd) => fn(cmd); ipcRenderer.on('menu', h); return () => ipcRenderer.off('menu', h) },
  onSettingsChanged: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('settings:changed', h); return () => ipcRenderer.off('settings:changed', h) },
  localModels: () => call('local:list'),
  downloadLocal: (id) => call('local:download', id),
  onLocalProgress: (fn) => { const h = (_e, id, p) => fn(id, p); ipcRenderer.on('local:progress', h); return () => ipcRenderer.off('local:progress', h) },
})
