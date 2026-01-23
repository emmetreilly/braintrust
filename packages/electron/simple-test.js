// Simple Electron test
const { app, BrowserWindow } = require('electron')

console.log('Script starting...')
console.log('process.versions:', process.versions)
console.log('process.versions.electron:', process.versions.electron)

app.whenReady().then(() => {
  console.log('App ready!')
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  win.loadURL('https://www.google.com')
  console.log('Window created and loading...')
})

app.on('window-all-closed', () => {
  app.quit()
})
