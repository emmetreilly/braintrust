import { useState } from 'react'

interface InsightCardProps {
  content: string
  authorName?: string
  documentName?: string
  onFollowup?: (question: string) => Promise<void>
  onClick?: () => void
}

export default function InsightCard({
  content,
  authorName,
  documentName: propDocName,
  onFollowup,
  onClick,
}: InsightCardProps) {
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Parse the content to extract document name if present (from content or props)
  const docMatch = content.match(/Brain insight about "([^"]+)"/)
  const documentName = propDocName || (docMatch ? docMatch[1] : null)

  // Clean up the content - remove the header since we show it differently
  const cleanContent = content
    .replace(/🧠 \*\*Brain insight.*?\*\*:?\n\n?/g, '')
    .trim()

  const handleReply = async () => {
    if (!replyText.trim() || isLoading || !onFollowup) return

    setIsLoading(true)
    try {
      await onFollowup(replyText.trim())
      setReplyText('')
      setShowReplyInput(false)
    } catch (err) {
      console.error('Failed to send follow-up:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleReply()
    }
    if (e.key === 'Escape') {
      setShowReplyInput(false)
      setReplyText('')
    }
  }

  return (
    <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/30 overflow-hidden max-w-md">
      {/* Header */}
      <div className="px-4 py-2 bg-cyan-500/10 border-b border-cyan-500/20 flex items-center gap-2">
        <span className="text-lg">🧠</span>
        <div className="flex-1">
          <span className="text-xs font-medium text-cyan-400">Brain Insight</span>
          {documentName && (
            <span className="text-xs text-zinc-500 ml-2">· {documentName}</span>
          )}
        </div>
        {authorName && (
          <span className="text-xs text-zinc-500">shared by {authorName}</span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="text-sm text-zinc-200 whitespace-pre-line line-clamp-6">{cleanContent}</p>
      </div>

      {/* Reply Input or Actions */}
      <div className="px-4 py-3 border-t border-cyan-500/20">
        {showReplyInput ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a follow-up question..."
              className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus
              disabled={isLoading}
            />
            <button
              onClick={handleReply}
              disabled={!replyText.trim() || isLoading}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? '...' : 'Ask'}
            </button>
            <button
              onClick={() => {
                setShowReplyInput(false)
                setReplyText('')
              }}
              className="text-zinc-500 hover:text-zinc-300 px-2 py-2 text-sm transition-colors"
              disabled={isLoading}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {onFollowup && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowReplyInput(true)
                }}
                className="flex-1 flex items-center gap-2 text-xs text-cyan-500 hover:text-cyan-400 hover:bg-cyan-500/10 px-3 py-2 rounded-lg transition-colors"
              >
                <span>💬</span>
                <span>Ask a follow-up question</span>
              </button>
            )}
            {onClick && (
              <button
                onClick={onClick}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <span>Go deeper</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
