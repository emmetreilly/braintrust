import { useState, useEffect } from 'react'
import { useChatStore } from '../../stores/chat'
import type { Message } from '../../types'

interface ExpandedMessageModalProps {
  message: Message
  authorName?: string
  onClose: () => void
}

export default function ExpandedMessageModal({ message, authorName, onClose }: ExpandedMessageModalProps) {
  const [followupInput, setFollowupInput] = useState('')
  const { setBrainInputPrefill } = useChatStore()

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleAskFollowup = () => {
    if (!followupInput.trim()) return

    // Prefill the Brain input with the follow-up question
    const prefill = `About this message from ${authorName || 'someone'}:\n"${message.content.slice(0, 200)}${message.content.length > 200 ? '...' : ''}"\n\nQuestion: ${followupInput}`
    setBrainInputPrefill(prefill)
    onClose()
  }

  const handleQuickQuestion = (question: string) => {
    const prefill = `About this message from ${authorName || 'someone'}:\n"${message.content.slice(0, 200)}${message.content.length > 200 ? '...' : ''}"\n\n${question}`
    setBrainInputPrefill(prefill)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-sm font-medium">
              {authorName?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <h3 className="font-medium">{authorName || 'Unknown'}</h3>
              <p className="text-xs text-zinc-500">
                {new Date(message.created_at).toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-2 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex gap-1 mt-4 pt-4 border-t border-zinc-800">
              {message.reactions.map((r, i) => (
                <span key={i} className="text-lg bg-zinc-800 px-2 py-1 rounded-full">
                  {r.emoji}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="p-4 border-t border-zinc-800 space-y-3">
          <p className="text-xs text-zinc-500 mb-2">Quick actions</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleQuickQuestion('Summarize this message for me')}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs transition-colors"
            >
              Summarize
            </button>
            <button
              onClick={() => handleQuickQuestion('What are the key points in this message?')}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs transition-colors"
            >
              Key points
            </button>
            <button
              onClick={() => handleQuickQuestion('What questions should I ask about this?')}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs transition-colors"
            >
              Suggest questions
            </button>
          </div>

          {/* Custom follow-up */}
          <div className="flex gap-2">
            <input
              type="text"
              value={followupInput}
              onChange={(e) => setFollowupInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleAskFollowup()
                }
              }}
              placeholder="Ask Brain a follow-up question..."
              className="flex-1 bg-zinc-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <button
              onClick={handleAskFollowup}
              disabled={!followupInput.trim()}
              className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:hover:bg-cyan-600 rounded-lg text-sm font-medium transition-colors"
            >
              Ask Brain
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
