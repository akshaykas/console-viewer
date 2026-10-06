const { contextBridge } = require('electron')

// Tells the page which OS it is on, for platform specific messages
contextBridge.exposeInMainWorld('consoleViewer', {
  platform: process.platform,
})
