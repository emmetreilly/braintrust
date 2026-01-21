import { useState } from 'react'
import type { Message } from '../../types'

interface MessageBubbleProps {
  message: Message
  isMe: boolean
  onTap: () => void
  onDelete?: () => void
}

export default function MessageBubble({ message, isMe, onTap, onDelete }: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false)

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isMe && onDelete) {
      e.preventDefault()
      setShowMenu(true)
    }
  }

  return (
    <div className="relative group">
      <div
        className={`rounded-2xl px-4 py-2.5 max-w-xs cursor-pointer ${
          isMe ? 'bg-cyan-600 rounded-br-sm' : 'bg-zinc-900 rounded-bl-sm'
        }`}
        onClick={onTap}
        onContextMenu={handleContextMenu}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        {message.reactions && message.reactions.length > 0 && (
          <div className="flex gap-0.5 mt-1.5 -mb-1">
            {message.reactions.map((r, j) => (
              <span key={j} className="text-sm">
                {r.emoji}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete button on hover for own messages */}
      {isMe && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(true)
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete message"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}

      {/* Confirmation dialog */}
      {showMenu && (
        <div className="absolute top-full right-0 mt-1 bg-zinc-800 rounded-lg shadow-lg z-10 overflow-hidden">
          <button
            onClick={() => {
              onDelete?.()
              setShowMenu(false)
            }}
            className="px-4 py-2 text-sm text-red-400 hover:bg-zinc-700 w-full text-left"
          >
            Delete message
          </button>
          <button
            onClick={() => setShowMenu(false)}
            className="px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-700 w-full text-left"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
