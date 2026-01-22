import { useState, useMemo } from 'react'

interface WebEmbedProps {
  url: string
  onClose: () => void
}

export default function WebEmbed({ url, onClose }: WebEmbedProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Transform URL for embedding
  const embedUrl = useMemo(() => {
    try {
      const urlObj = new URL(url)

      // YouTube
      if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
        let videoId: string | null = null
        if (urlObj.hostname.includes('youtu.be')) {
          videoId = urlObj.pathname.slice(1)
        } else {
          videoId = urlObj.searchParams.get('v')
        }
        if (videoId) {
          return `https://www.youtube.com/embed/${videoId}`
        }
      }

      // Vimeo
      if (urlObj.hostname.includes('vimeo.com')) {
        const videoId = urlObj.pathname.split('/').pop()
        if (videoId) {
          return `https://player.vimeo.com/video/${videoId}`
        }
      }

      // For other URLs, try to embed directly (may be blocked by X-Frame-Options)
      return url
    } catch {
      return url
    }
  }, [url])

  const embedType = useMemo(() => {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube'
    if (url.includes('vimeo.com')) return 'Vimeo'
    if (url.includes('twitter.com') || url.includes('x.com')) return 'Twitter'
    return 'Website'
  }, [url])

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs hover:bg-zinc-700 transition-colors"
          title="Close"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">{embedType}</h3>
          <p className="text-[10px] text-zinc-500 truncate">{url}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => window.open(url, '_blank')}
            className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
            title="Open in new tab"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs hover:bg-red-500/20 hover:text-red-400 transition-colors text-zinc-400"
            title="Close embed"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Embed content */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
              <span className="text-xs text-zinc-500">Loading {embedType}...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <div className="text-center p-4">
              <div className="text-3xl mb-2">🚫</div>
              <p className="text-sm text-zinc-400 mb-2">Can&apos;t embed this content</p>
              <p className="text-xs text-zinc-600 mb-4">{error}</p>
              <button
                onClick={() => window.open(url, '_blank')}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm transition-colors"
              >
                Open in New Tab
              </button>
            </div>
          </div>
        )}

        <iframe
          src={embedUrl}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false)
            setError('This site cannot be embedded')
          }}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-600 text-center">
        Press ← to return to Brain chat
      </div>
    </div>
  )
}
