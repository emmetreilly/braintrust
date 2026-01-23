import { useEffect, useRef, useState, useCallback } from 'react'
import { getElectronAPI, boundsToObject, getPageContent } from '../../lib/electron'
import { useChatStore } from '../../stores/chat'

interface ElectronWebViewProps {
  tabId: string
  url: string
  title: string
  onTitleChange?: (title: string) => void
  onNavigate?: (url: string) => void
  onClose?: () => void
}

/**
 * A component that renders either:
 * - An Electron BrowserView (full browser capabilities, no restrictions)
 * - A fallback iframe (for web version, with limitations)
 */
export default function ElectronWebView({
  tabId,
  url,
  title,
  onTitleChange,
  onNavigate,
  onClose,
}: ElectronWebViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isUsingBrowserView, setIsUsingBrowserView] = useState(false)
  const [iframeError, setIframeError] = useState(false)
  const [currentUrl, setCurrentUrl] = useState(url)
  const [currentTitle, setCurrentTitle] = useState(title)
  const [isLoading, setIsLoading] = useState(true)

  const { removeContentTab, setActiveContentTabId, contentTabs } = useChatStore()

  const electron = getElectronAPI()

  // Close this tab and return to chat
  const closeTab = useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      // Find the chat tab or first available tab
      const chatTab = contentTabs.find(t => t.type === 'chat')
      if (chatTab) {
        setActiveContentTabId(chatTab.id)
      }
      removeContentTab(tabId)
    }
  }, [onClose, contentTabs, setActiveContentTabId, removeContentTab, tabId])

  // Initialize BrowserView if in Electron
  useEffect(() => {
    if (!electron || !containerRef.current) {
      setIsLoading(false)
      return
    }

    const initBrowserView = async () => {
      const bounds = containerRef.current!.getBoundingClientRect()
      const result = await electron.browserView.open(tabId, url, boundsToObject(bounds))

      if (result.success) {
        setIsUsingBrowserView(true)
      }
      setIsLoading(false)
    }

    initBrowserView()

    // Cleanup on unmount
    return () => {
      if (electron) {
        electron.browserView.close(tabId)
      }
    }
  }, [tabId]) // Only run on mount/unmount

  // Update URL when it changes
  useEffect(() => {
    if (!electron || !isUsingBrowserView) return

    const updateUrl = async () => {
      const bounds = containerRef.current?.getBoundingClientRect()
      if (bounds) {
        await electron.browserView.open(tabId, url, boundsToObject(bounds))
      }
    }

    if (url !== currentUrl) {
      updateUrl()
      setCurrentUrl(url)
    }
  }, [url, electron, isUsingBrowserView, tabId, currentUrl])

  // Handle container resize
  useEffect(() => {
    if (!electron || !isUsingBrowserView || !containerRef.current) return

    const updateBounds = () => {
      const bounds = containerRef.current?.getBoundingClientRect()
      if (bounds) {
        electron.browserView.setBounds(tabId, boundsToObject(bounds))
      }
    }

    // Use ResizeObserver for accurate resize detection
    const observer = new ResizeObserver(updateBounds)
    observer.observe(containerRef.current)

    // Also update on window resize
    window.addEventListener('resize', updateBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [electron, isUsingBrowserView, tabId])

  // Track if we're in an auth flow
  const [showAuthComplete, setShowAuthComplete] = useState(false)

  // Listen for navigation events from BrowserView
  useEffect(() => {
    if (!electron) return

    const unsubNavigated = electron.browserView.onNavigated(({ tabId: tid, url: newUrl }) => {
      if (tid === tabId) {
        setCurrentUrl(newUrl)
        onNavigate?.(newUrl)

        // Detect OAuth callback patterns - suggest returning to app
        const isOAuthCallback =
          newUrl.includes('/oauth/callback') ||
          newUrl.includes('/auth/callback') ||
          newUrl.includes('code=') ||
          newUrl.includes('/settings?success=') ||
          newUrl.includes('/settings?error=') ||
          (newUrl.includes('localhost') && newUrl.includes('code='))

        if (isOAuthCallback) {
          setShowAuthComplete(true)
        }
      }
    })

    const unsubTitle = electron.browserView.onTitleUpdated(({ tabId: tid, title: newTitle }) => {
      if (tid === tabId) {
        setCurrentTitle(newTitle)
        onTitleChange?.(newTitle)
      }
    })

    return () => {
      unsubNavigated()
      unsubTitle()
    }
  }, [electron, tabId, onNavigate, onTitleChange])

  // Navigation controls
  const goBack = useCallback(() => {
    electron?.browserView.goBack(tabId)
  }, [electron, tabId])

  const goForward = useCallback(() => {
    electron?.browserView.goForward(tabId)
  }, [electron, tabId])

  const reload = useCallback(() => {
    electron?.browserView.reload(tabId)
  }, [electron, tabId])

  // Get content for Claude
  const extractContent = useCallback(async () => {
    return await getPageContent(tabId)
  }, [tabId])

  // Handle iframe load error (for web version)
  const handleIframeError = useCallback(() => {
    setIframeError(true)
    setIsLoading(false)
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="text-zinc-500 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-zinc-600 border-t-cyan-500 rounded-full animate-spin" />
          Loading...
        </div>
      </div>
    )
  }

  // Electron: BrowserView renders natively, we just need a placeholder div
  if (isUsingBrowserView) {
    return (
      <div className="h-full flex flex-col">
        {/* Navigation bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
          {/* Done button - prominent way to return to app */}
          <button
            onClick={closeTab}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded transition-colors flex items-center gap-1.5"
            title="Close and return to app"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Done
          </button>

          <div className="w-px h-5 bg-zinc-700 mx-1" />

          <button
            onClick={goBack}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"
            title="Back"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goForward}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"
            title="Forward"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={reload}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"
            title="Reload"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          <div className="flex-1 mx-2 flex flex-col">
            <div className="bg-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-400 truncate">
              {currentUrl}
            </div>
            {currentTitle && currentTitle !== title && (
              <div className="text-xs text-zinc-500 mt-0.5 truncate px-1">
                {currentTitle}
              </div>
            )}
          </div>

          <button
            onClick={async () => {
              const content = await extractContent()
              if (content) {
                // Could dispatch to Claude panel
                console.log('Page content extracted:', content.title)
              }
            }}
            className="p-1.5 text-zinc-500 hover:text-cyan-400 hover:bg-zinc-800 rounded transition-colors"
            title="Send to Claude"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
        </div>

        {/* Auth complete banner */}
        {showAuthComplete && (
          <div className="flex items-center justify-between px-4 py-3 bg-green-900/50 border-b border-green-700">
            <div className="flex items-center gap-2 text-green-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">Authentication complete!</span>
            </div>
            <button
              onClick={closeTab}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded transition-colors"
            >
              Return to App
            </button>
          </div>
        )}

        {/* BrowserView container - Electron renders the view here */}
        <div ref={containerRef} className="flex-1" />
      </div>
    )
  }

  // Web fallback: iframe with error handling
  if (iframeError) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-400 p-8">
        <div className="text-5xl mb-4">🔒</div>
        <h3 className="text-lg font-medium text-white mb-2">Cannot load this site</h3>
        <p className="text-sm text-center mb-4 max-w-md">
          This website doesn't allow embedding. For full browsing capabilities,
          use the Brain Trust desktop app.
        </p>
        <div className="flex gap-3">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-500 transition-colors"
          >
            Open in browser
          </a>
        </div>
        <p className="text-xs text-zinc-600 mt-6">
          URL: {url}
        </p>
      </div>
    )
  }

  // Web fallback: try iframe
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex-1 mx-2">
          <div className="bg-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-400 truncate">
            {url}
          </div>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"
          title="Open in new tab"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
      <iframe
        src={url}
        className="flex-1 w-full bg-white"
        title={title}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onError={handleIframeError}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  )
}
