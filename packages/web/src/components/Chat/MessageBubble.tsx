import type { Message } from '../../types'

interface MessageBubbleProps {
  message: Message
  isMe: boolean
  onTap: () => void
}

export default function MessageBubble({ message, isMe, onTap }: MessageBubbleProps) {
  return (
    <div
      className={`rounded-2xl px-4 py-2.5 max-w-xs cursor-pointer ${
        isMe ? 'bg-cyan-600 rounded-br-sm' : 'bg-zinc-900 rounded-bl-sm'
      }`}
      onClick={onTap}
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
  )
}
