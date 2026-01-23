import { useState } from 'react'

interface WebContainerProps {
  url: string
  title: string
  onBack: () => void
}

// Sites that block iframe embedding
const BLOCKED_SITES = [
  'mail.google.com',
  'app.hubspot.com',
  'github.com',
]

export default function WebContainer({ url, title, onBack }: WebContainerProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const urlObj = new URL(url)
  const isBlocked = BLOCKED_SITES.some(site => urlObj.hostname.includes(site))

  const handleOpenInNewTab = () => {
    window.open(url, '_blank')
  }

  if (isBlocked) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="font-medium">{title}</h2>
            <p className="text-xs text-zinc-500 truncate">{url}</p>
          </div>
          <button
            onClick={handleOpenInNewTab}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            Open in new tab
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </div>

        {/* Blocked message */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="text-5xl mb-4">🚫</div>
            <h3 className="text-xl font-medium mb-2">Can't embed {title}</h3>
            <p className="text-zinc-500 mb-6 max-w-md">
              This site doesn't allow embedding in other applications for security reasons.
            </p>
            <button
              onClick={handleOpenInNewTab}
              className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 rounded-xl text-black font-medium transition-colors"
            >
              Open in new tab
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="font-medium">{title}</h2>
          <p className="text-xs text-zinc-500 truncate">{url}</p>
        </div>
        <button
          onClick={handleOpenInNewTab}
          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
          title="Open in new tab"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
              <span className="text-sm text-zinc-500">Loading {title}...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <div className="text-center p-8">
              <div className="text-5xl mb-4">⚠️</div>
              <h3 className="text-xl font-medium mb-2">Failed to load</h3>
              <p className="text-zinc-500 mb-6">{error}</p>
              <button
                onClick={handleOpenInNewTab}
                className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 rounded-xl text-black font-medium transition-colors"
              >
                Open in new tab
              </button>
            </div>
          </div>
        )}

        <iframe
          src={url}
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false)
            setError('This site cannot be embedded')
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          allow="clipboard-read; clipboard-write"
        />
      </div>

      {/* Footer tip */}
      <div className="p-3 border-t border-zinc-800 text-center">
        <p className="text-xs text-zinc-600">
          💡 Copy text from here and search it in Brain Trust
        </p>
      </div>
    </div>
  )
}
