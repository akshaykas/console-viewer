const { contextBridge, ipcRenderer } = require('electron')

// The only things the page can ask of the main process
contextBridge.exposeInMainWorld('consoleViewer', {
  platform: process.platform,
  // Saves a screenshot or clip and returns where it went
  saveCapture: (kind, ext, data) => ipcRenderer.invoke('capture:save', kind, ext, data),
  revealFile: (file) => ipcRenderer.invoke('capture:reveal', file),
  copyImage: (data) => ipcRenderer.invoke('capture:copy-image', data),
})
