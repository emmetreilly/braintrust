// Electron integration utilities

export interface ElectronAPI {
  isElectron: true
  browserView: {
    open: (tabId: string, url: string, bounds: DOMRect | { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; error?: string }>
    setBounds: (tabId: string, bounds: DOMRect | { x: number; y: number; width: number; height: number }) => Promise<void>
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

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

// Check if running in Electron
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electron?.isElectron
}

// Get the Electron API (returns null if not in Electron)
export function getElectronAPI(): ElectronAPI | null {
  if (isElectron()) {
    return window.electron!
  }
  return null
}

// Helper to convert DOMRect to plain object (for IPC)
export function boundsToObject(bounds: DOMRect | { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
}

// Open a URL in BrowserView (Electron) or return false to use iframe (web)
export async function openInBrowserView(
  tabId: string,
  url: string,
  containerRef: React.RefObject<HTMLElement>
): Promise<boolean> {
  const electron = getElectronAPI()
  if (!electron || !containerRef.current) {
    return false // Fall back to iframe
  }

  const bounds = containerRef.current.getBoundingClientRect()
  const result = await electron.browserView.open(tabId, url, boundsToObject(bounds))
  return result.success
}

// Update BrowserView bounds when container resizes
export async function updateBrowserViewBounds(
  tabId: string,
  containerRef: React.RefObject<HTMLElement>
): Promise<void> {
  const electron = getElectronAPI()
  if (!electron || !containerRef.current) return

  const bounds = containerRef.current.getBoundingClientRect()
  await electron.browserView.setBounds(tabId, boundsToObject(bounds))
}

// Get page content from BrowserView for Claude analysis
export async function getPageContent(tabId: string): Promise<{ title: string; url: string; text: string } | null> {
  const electron = getElectronAPI()
  if (!electron) return null

  const result = await electron.browserView.getContent(tabId)
  if (result.success && result.content) {
    return result.content
  }
  return null
}
