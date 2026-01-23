const { contextBridge, ipcRenderer } = require('electron')

// Expose Electron APIs to the renderer process securely
contextBridge.exposeInMainWorld('electron', {
  // Check if running in Electron
  isElectron: true,

  // BrowserView management for embedded browsing
  browserView: {
    // Open a URL in an embedded browser view
    open: (tabId, url, bounds) =>
      ipcRenderer.invoke('browser-view:open', { tabId, url, bounds }),

    // Update the bounds of a browser view (when panel resizes)
    setBounds: (tabId, bounds) =>
      ipcRenderer.invoke('browser-view:set-bounds', { tabId, bounds }),

    // Show a specific browser view (when switching tabs)
    show: (tabId) => ipcRenderer.invoke('browser-view:show', { tabId }),

    // Hide a browser view
    hide: (tabId) => ipcRenderer.invoke('browser-view:hide', { tabId }),

    // Close and destroy a browser view
    close: (tabId) => ipcRenderer.invoke('browser-view:close', { tabId }),

    // Navigation controls
    goBack: (tabId) => ipcRenderer.invoke('browser-view:go-back', { tabId }),
    goForward: (tabId) => ipcRenderer.invoke('browser-view:go-forward', { tabId }),
    reload: (tabId) => ipcRenderer.invoke('browser-view:reload', { tabId }),

    // Get page content for Claude analysis
    getContent: (tabId) => ipcRenderer.invoke('browser-view:get-content', { tabId }),

    // Event listeners for browser view updates
    onNavigated: (callback) => {
      const handler = (event, data) => callback(data)
      ipcRenderer.on('browser-view:navigated', handler)
      return () => ipcRenderer.removeListener('browser-view:navigated', handler)
    },

    onTitleUpdated: (callback) => {
      const handler = (event, data) => callback(data)
      ipcRenderer.on('browser-view:title-updated', handler)
      return () => ipcRenderer.removeListener('browser-view:title-updated', handler)
    },

    onNewWindow: (callback) => {
      const handler = (event, data) => callback(data)
      ipcRenderer.on('browser-view:new-window', handler)
      return () => ipcRenderer.removeListener('browser-view:new-window', handler)
    },
  },

  // Platform info
  platform: process.platform,
})

// Add type definitions for TypeScript (in a comment for reference)
/*
declare global {
  interface Window {
    electron?: {
      isElectron: true
      browserView: {
        open: (tabId: string, url: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; error?: string }>
        setBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
        show: (tabId: string) => Promise<void>
        hide: (tabId: string) => Promise<void>
        close: (tabId: string) => Promise<void>
        goBack: (tabId: string) => Promise<void>
        goForward: (tabId: string) => Promise<void>
        reload: (tabId: string) => Promise<void>
        getContent: (tabId: string) => Promise<{ success: boolean; content?: { title: string; url: string; text: string }; error?: string }>
        onNavigated: (callback: (data: { tabId: string; url: string }) => void) => () => void
        onTitleUpdated: (callback: (data: { tabId: string; title: string }) => void) => () => void
        onNewWindow: (callback: (data: { tabId: string; url: string }) => void) => () => void
      }
      platform: string
    }
  }
}
*/
