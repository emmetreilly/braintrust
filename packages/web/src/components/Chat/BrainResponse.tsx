import { useState } from 'react'
import type { Message } from '../../types'
import { brain as brainApi } from '../../lib/api'

interface BrainResponseProps {
  message: Message
  onTap: () => void
  onShare?: (sharedMessage: Message) => void
}

export default function BrainResponse({ message, onTap, onShare }: BrainResponseProps) {
  const [isSharing, setIsSharing] = useState(false)
  const isPrivate = !!message.visible_to

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isSharing) return

    setIsSharing(true)
    try {
      const result = await brainApi.shareMessage(message.id)
      if (onShare) {
        onShare(result.message)
      }
    } catch (err) {
      console.error('Failed to share message:', err)
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <div
      className={`rounded-2xl px-4 py-3 rounded-bl-sm max-w-xs cursor-pointer ${
        isPrivate
          ? 'bg-zinc-900/60 border border-dashed border-zinc-700'
          : 'bg-zinc-900 border border-zinc-800'
      }`}
      onClick={onTap}
    >
      {isPrivate && (
        <div className="text-xs text-zinc-500 italic mb-2 flex items-center gap-1">
          <span className="opacity-60">👁</span> Only visible to you
        </div>
      )}
      <p className={`text-sm whitespace-pre-line ${isPrivate ? 'text-zinc-300' : ''}`}>{message.content}</p>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-zinc-600 flex items-center gap-1">
          <span>💭</span> Tap to go deeper
        </div>
        {isPrivate && (
          <button
            onClick={handleShare}
            disabled={isSharing}
            className="text-xs text-cyan-500 hover:text-cyan-400 px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors disabled:opacity-50"
          >
            {isSharing ? 'Sharing...' : 'Share with group'}
          </button>
        )}
      </div>
    </div>
  )
}
