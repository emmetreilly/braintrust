const { app, BrowserWindow, BrowserView, ipcMain, shell, Menu } = require('electron')
const path = require('path')

// Keep a global reference of windows
let mainWindow = null
const browserViews = new Map() // tabId -> BrowserView

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset', // macOS: traffic lights in titlebar
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false, // Use BrowserView instead
    },
  })

  // Load the app
  if (isDev) {
    // Try common Vite ports
    const devPort = process.env.VITE_PORT || 5173
    mainWindow.loadURL(`http://localhost:${devPort}`)
    mainWindow.webContents.openDevTools()
  } else {
    // Production: load from bundled files
    mainWindow.loadFile(path.join(__dirname, '../web/dist/index.html'))
  }

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    // Clean up all BrowserViews
    browserViews.forEach((view) => {
      if (view && !view.isDestroyed()) {
        view.webContents.destroy()
      }
    })
    browserViews.clear()
  })

  // Update BrowserView bounds when window resizes
  mainWindow.on('resize', () => {
    updateActiveBrowserViewBounds()
  })
}

// Calculate bounds for BrowserView based on panel position
function calculateBrowserViewBounds(panelBounds) {
  if (!mainWindow || !panelBounds) return null

  const [windowWidth, windowHeight] = mainWindow.getSize()

  return {
    x: Math.round(panelBounds.x),
    y: Math.round(panelBounds.y),
    width: Math.round(panelBounds.width),
    height: Math.round(panelBounds.height),
  }
}

function updateActiveBrowserViewBounds() {
  // This will be called by renderer when panel bounds change
}

// IPC Handlers for BrowserView management

// Open a URL in a BrowserView (for embedded browsing)
ipcMain.handle('browser-view:open', async (event, { tabId, url, bounds }) => {
  if (!mainWindow) return { success: false, error: 'No main window' }

  try {
    // Check if view already exists for this tab
    let view = browserViews.get(tabId)

    if (!view) {
      // Create new BrowserView
      view = new BrowserView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      browserViews.set(tabId, view)

      // Handle navigation events
      view.webContents.on('did-navigate', (e, navUrl) => {
        mainWindow.webContents.send('browser-view:navigated', { tabId, url: navUrl })
      })

      view.webContents.on('page-title-updated', (e, title) => {
        mainWindow.webContents.send('browser-view:title-updated', { tabId, title })
      })

      // Handle new window requests (open in view or external)
      view.webContents.setWindowOpenHandler(({ url }) => {
        // Send to renderer to decide what to do
        mainWindow.webContents.send('browser-view:new-window', { tabId, url })
        return { action: 'deny' }
      })
    }

    // Load the URL
    await view.webContents.loadURL(url)

    // Set bounds and attach to window
    if (bounds) {
      const calculatedBounds = calculateBrowserViewBounds(bounds)
      if (calculatedBounds) {
        view.setBounds(calculatedBounds)
      }
    }

    mainWindow.addBrowserView(view)

    return { success: true }
  } catch (error) {
    console.error('Failed to open BrowserView:', error)
    return { success: false, error: error.message }
  }
})

// Update BrowserView bounds (when panel resizes)
ipcMain.handle('browser-view:set-bounds', async (event, { tabId, bounds }) => {
  const view = browserViews.get(tabId)
  if (!view || !mainWindow) return

  const calculatedBounds = calculateBrowserViewBounds(bounds)
  if (calculatedBounds) {
    view.setBounds(calculatedBounds)
  }
})

// Show/hide a BrowserView (when switching tabs)
ipcMain.handle('browser-view:show', async (event, { tabId }) => {
  // Hide all views first
  browserViews.forEach((view, id) => {
    if (mainWindow.getBrowserViews().includes(view)) {
      mainWindow.removeBrowserView(view)
    }
  })

  // Show the requested view
  const view = browserViews.get(tabId)
  if (view && mainWindow) {
    mainWindow.addBrowserView(view)
  }
})

ipcMain.handle('browser-view:hide', async (event, { tabId }) => {
  const view = browserViews.get(tabId)
  if (view && mainWindow && mainWindow.getBrowserViews().includes(view)) {
    mainWindow.removeBrowserView(view)
  }
})

// Close a BrowserView
ipcMain.handle('browser-view:close', async (event, { tabId }) => {
  const view = browserViews.get(tabId)
  if (view) {
    if (mainWindow && mainWindow.getBrowserViews().includes(view)) {
      mainWindow.removeBrowserView(view)
    }
    view.webContents.destroy()
    browserViews.delete(tabId)
  }
})

// Navigate back/forward
ipcMain.handle('browser-view:go-back', async (event, { tabId }) => {
  const view = browserViews.get(tabId)
  if (view && view.webContents.canGoBack()) {
    view.webContents.goBack()
  }
})

ipcMain.handle('browser-view:go-forward', async (event, { tabId }) => {
  const view = browserViews.get(tabId)
  if (view && view.webContents.canGoForward()) {
    view.webContents.goForward()
  }
})

// Reload
ipcMain.handle('browser-view:reload', async (event, { tabId }) => {
  const view = browserViews.get(tabId)
  if (view) {
    view.webContents.reload()
  }
})

// Get page content for Claude analysis
ipcMain.handle('browser-view:get-content', async (event, { tabId }) => {
  const view = browserViews.get(tabId)
  if (!view) return { success: false, error: 'View not found' }

  try {
    // Extract text content from the page
    const content = await view.webContents.executeJavaScript(`
      (function() {
        // Try to get article content first
        const article = document.querySelector('article') ||
                       document.querySelector('[role="main"]') ||
                       document.querySelector('main') ||
                       document.body;

        // Get text content, clean up whitespace
        const text = article.innerText
          .replace(/\\s+/g, ' ')
          .replace(/\\n\\s*\\n/g, '\\n\\n')
          .trim();

        return {
          title: document.title,
          url: window.location.href,
          text: text.slice(0, 50000), // Limit for Claude context
        };
      })()
    `)

    return { success: true, content }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Check if running in Electron
ipcMain.handle('is-electron', () => true)

// App lifecycle
app.whenReady().then(() => {
  createWindow()

  // macOS: re-create window when clicking dock icon
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Security: prevent navigation to file:// URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    if (parsedUrl.protocol === 'file:') {
      event.preventDefault()
    }
  })
})
