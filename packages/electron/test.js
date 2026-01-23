const electron = require('electron')
console.log('electron module:', electron)
console.log('app:', electron.app)
console.log('BrowserWindow:', electron.BrowserWindow)
console.log('ipcMain:', electron.ipcMain)

if (electron.app) {
  electron.app.whenReady().then(() => {
    console.log('App is ready!')
    const win = new electron.BrowserWindow({ width: 800, height: 600 })
    win.loadURL('https://google.com')
  })
} else {
  console.log('app is not available - might be in renderer process')
}
