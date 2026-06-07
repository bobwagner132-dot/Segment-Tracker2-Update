const { app, BrowserWindow, session } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

app.disableHardwareAcceleration()

app.disableHardwareAcceleration()
let pythonProcess = null

function startPythonBackend() {
  const venvPython = require('fs').existsSync(path.join(__dirname, '../venv/bin/python3')) ? path.join(__dirname, '../venv/bin/python3') : '/Users/BobW/Segment-Tracker2-Update/venv/bin/python3'
  const backendDir = require('fs').existsSync(path.join(__dirname, '../backend')) ? path.join(__dirname, '../backend') : '/Users/BobW/Segment-Tracker2-Update/backend'
  const dataDir = path.join(app.getPath('documents'), 'CyclingTracker')

  pythonProcess = spawn(venvPython, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: backendDir,
    env: {
      ...process.env,
      CST_DATA_DIR: dataDir,
      JWT_SECRET: 'local-mac-secret-change-this-if-you-like',
    }
  })

  pythonProcess.stdout.on('data', (data) => console.log(`backend: ${data}`))
  pythonProcess.stderr.on('data', (data) => console.log(`backend: ${data}`))
}

function waitForBackend(url, retries, delay, callback) {
  const http = require('http')
  http.get(url, (res) => {
    callback()
  }).on('error', () => {
    if (retries > 0) {
      setTimeout(() => waitForBackend(url, retries - 1, delay, callback), delay)
    }
  })
}

async function createWindow() {
  await session.defaultSession.clearStorageData({
    storages: ['serviceworkers', 'cachestorage']
  })

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Segment Tracker',
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
    },
    titleBarStyle: 'default',
  })

  waitForBackend('http://127.0.0.1:8000', 20, 500, () => {
    win.loadURL('http://127.0.0.1:8000')
    win.webContents.on('did-finish-load', () => {
      win.webContents.invalidate()
    })
  win.on('focus', () => {
    win.webContents.invalidate()
  })
  })
}

app.whenReady().then(() => {
  startPythonBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (pythonProcess) pythonProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (pythonProcess) pythonProcess.kill()
})

// Enable DevTools with keyboard shortcut
app.on('browser-window-created', (_, window) => {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.alt && input.key === 'i') {
      window.webContents.toggleDevTools()
    }
  })
})
