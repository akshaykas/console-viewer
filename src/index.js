const { app, BrowserWindow, session, systemPreferences } = require('electron')
const path = require('node:path')

// Handle creating and removing shortcuts on Windows when installing or uninstalling
if (require('electron-squirrel-startup')) {
  app.quit()
}

// The page only ever needs the capture device and full screen
const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen'])

function lockDownSession() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )
}

// macOS treats the dongle as a camera and a microphone, so ask up front.
// Without this a signed build can silently fail to open the device.
async function requestMacMediaAccess() {
  if (process.platform !== 'darwin') return
  for (const type of ['camera', 'microphone']) {
    if (systemPreferences.getMediaAccessStatus(type) === 'not-determined') {
      await systemPreferences.askForMediaAccess(type)
    }
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 480,
    minHeight: 270,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Console Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // This app never needs to open links or navigate away
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(async () => {
  lockDownSession()
  await requestMacMediaAccess()
  createWindow()

  // On macOS, reopen a window when the dock icon is clicked and none are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS where apps usually stay open
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
