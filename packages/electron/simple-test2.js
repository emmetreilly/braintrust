// Simple Electron test - try different import
console.log('Script starting...')
console.log('process.versions.electron:', process.versions.electron)

const electron = require('electron')
console.log('electron module type:', typeof electron)
console.log('electron module:', electron)

// Try accessing directly from the electron object
if (typeof electron === 'object' && electron.app) {
  console.log('Found app on electron object')
  electron.app.whenReady().then(() => {
    console.log('App ready!')
    const win = new electron.BrowserWindow({
      width: 800,
      height: 600,
    })
    win.loadURL('https://www.google.com')
  })
} else if (typeof electron === 'string') {
  console.log('electron is a string (path):', electron)
  console.log('This means require("electron") is returning the wrong thing')
  console.log('Trying process.electronBinding...')
}
