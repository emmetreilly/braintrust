import { useState } from 'react'
import { useDrag } from 'react-dnd'
import type { Message } from '../../types'
import { brain as brainApi } from '../../lib/api'
import { DragTypes } from '../ui/DragDropContext'

interface BrainResponseProps {
  message: Message
  onTap: () => void
  onShare?: (sharedMessage: Message) => void
}

// Minimal Brain response - just text, Slack-style
// Draggable to share
export default function BrainResponse({ message, onShare }: BrainResponseProps) {
  const [isSharing, setIsSharing] = useState(false)
  const isPrivate = !!message.visible_to

  // Make draggable to share in chat
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DragTypes.BRAIN_RESPONSE,
    item: {
      type: DragTypes.BRAIN_RESPONSE,
      content: message.content,
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [message.content])

  const handleShare = async () => {
    if (isSharing) return
    setIsSharing(true)
    try {
      const result = await brainApi.shareMessage(message.id)
      if (onShare) onShare(result.message)
    } catch (err) {
      console.error('Failed to share message:', err)
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <div
      ref={drag}
      className={`${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Just the content */}
      <p className="text-sm whitespace-pre-line">{message.content}</p>

      {/* Private indicator - minimal */}
      {isPrivate && (
        <button
          onClick={handleShare}
          disabled={isSharing}
          className="text-xs text-zinc-500 hover:text-cyan-400 mt-1"
        >
          {isSharing ? 'sharing...' : 'only you · share'}
        </button>
      )}
    </div>
  )
}
