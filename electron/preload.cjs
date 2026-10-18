// The only bridge between the page and the main process. Every call returns a value or throws
// the main process's error message.
const { contextBridge, ipcRenderer } = require('electron')

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

contextBridge.exposeInMainWorld('rh', {
  getSettings: () => call('settings:get'),
  setSettings: (patch, secrets) => call('settings:set', patch, secrets),
  listModels: (backend) => call('models:list', backend),
  complete: (prompt) => call('ai:complete', prompt),
  search: (query) => call('search:web', query),
})
