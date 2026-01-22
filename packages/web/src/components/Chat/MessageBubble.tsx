import { useState } from 'react'
import { useDrag } from 'react-dnd'
import { DragTypes, MessageDragItem } from '../ui/DragDropContext'
import type { Message } from '../../types'

interface MessageBubbleProps {
  message: Message
  isMe: boolean
  authorName?: string
  onDelete?: () => void
  onOpenLink?: (url: string) => void
}

// URL detection regex
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g

// Minimal Slack-style message bubble - just text, draggable
export default function MessageBubble({ message, isMe, authorName, onDelete, onOpenLink }: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false)

  // Make message draggable
  const [{ isDragging }, drag] = useDrag<MessageDragItem, void, { isDragging: boolean }>(() => ({
    type: DragTypes.MESSAGE_TEXT,
    item: {
      type: DragTypes.MESSAGE_TEXT,
      content: message.content,
      messageId: message.id,
      authorName: authorName,
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [message, authorName])

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isMe && onDelete) {
      e.preventDefault()
      setShowMenu(true)
    }
  }

  const handleLinkClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation()
    if (onOpenLink) {
      onOpenLink(url)
    } else {
      window.open(url, '_blank')
    }
  }

  // Render content with clickable links
  const renderContent = (text: string) => {
    const parts = text.split(URL_REGEX)
    return parts.map((part, i) => {
      if (part.match(URL_REGEX)) {
        return (
          <button
            key={i}
            onClick={(e) => handleLinkClick(e, part)}
            className="text-cyan-300 hover:text-cyan-200 underline break-all"
          >
            {part}
          </button>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="relative group">
      <div
        ref={drag}
        className={`rounded-2xl px-4 py-2.5 max-w-md ${
          isMe ? 'bg-cyan-600 rounded-br-sm' : 'bg-zinc-900 rounded-bl-sm'
        } ${isDragging ? 'opacity-50' : ''}`}
        onContextMenu={handleContextMenu}
      >
        <p className="text-sm whitespace-pre-wrap break-words">
          {renderContent(message.content)}
        </p>
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

      {/* Drag indicator on hover */}
      <div className={`absolute top-1/2 -translate-y-1/2 ${isMe ? '-left-6' : '-right-6'} text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity`}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
        </svg>
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
