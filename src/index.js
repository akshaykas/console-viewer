const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  session,
  shell,
  systemPreferences,
} = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

// The website opens the installed app through links like console-viewer://open
const PROTOCOL = 'console-viewer'

// Squirrel installs a stable launcher one folder above each versioned app folder.
// Pointing the link there keeps it working after updates.
function protocolLauncher() {
  return path.resolve(path.dirname(process.execPath), '..', path.basename(process.execPath))
}

// Remove the link handler on uninstall, before Squirrel's own handling quits the app
if (process.platform === 'win32' && process.argv.includes('--squirrel-uninstall')) {
  app.removeAsDefaultProtocolClient(PROTOCOL, protocolLauncher(), [])
}

// Handle creating and removing shortcuts on Windows when installing or uninstalling
if (require('electron-squirrel-startup')) {
  app.quit()
}

function registerProtocol() {
  if (process.defaultApp) {
    // Running with npm start, so Windows needs the path to the script too
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  } else if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient(PROTOCOL, protocolLauncher(), [])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}

// Opening a link while the app is running should focus it, not start a second copy
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function focusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

app.on('second-instance', focusMainWindow)

// macOS delivers links through this event instead
app.on('open-url', (event) => {
  event.preventDefault()
  if (app.isReady()) {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else focusMainWindow()
  }
})

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
      // Keep drawing at full speed while another window has focus or picture in picture is open
      backgroundThrottling: false,
    },
  })

  // This app never needs to open links or navigate away
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
}

// Screenshots go to Pictures and clips to Videos, in a Console Viewer folder
const CAPTURE_TYPES = {
  screenshot: { folder: 'pictures', exts: new Set(['png']) },
  video: { folder: 'videos', exts: new Set(['mp4', 'webm']) },
}
const savedFiles = new Set()

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

ipcMain.handle('capture:save', async (event, kind, ext, data) => {
  const type = CAPTURE_TYPES[kind]
  if (!type || !type.exts.has(ext) || !(data instanceof ArrayBuffer)) {
    throw new Error('Unsupported capture')
  }
  const dir = path.join(app.getPath(type.folder), 'Console Viewer')
  await fs.mkdir(dir, { recursive: true })
  const prefix = kind === 'screenshot' ? 'Screenshot' : 'Clip'
  let file = path.join(dir, `${prefix} ${timestamp()}.${ext}`)
  for (let n = 2; await fs.stat(file).then(() => true, () => false); n++) {
    file = path.join(dir, `${prefix} ${timestamp()} (${n}).${ext}`)
  }
  await fs.writeFile(file, Buffer.from(data))
  savedFiles.add(file)
  return file
})

// Only reveals files this app saved
ipcMain.handle('capture:reveal', (event, file) => {
  if (savedFiles.has(file)) shell.showItemInFolder(file)
})

ipcMain.handle('capture:copy-image', (event, data) => {
  if (!(data instanceof ArrayBuffer)) return false
  const image = nativeImage.createFromBuffer(Buffer.from(data))
  if (image.isEmpty()) return false
  // writeImage was removed in newer Electron versions, write works in all of them
  clipboard.write({ image })
  return true
})

app.whenReady().then(async () => {
  if (!gotLock) return
  registerProtocol()
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
