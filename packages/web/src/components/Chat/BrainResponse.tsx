import type { Message } from '../../types'

interface BrainResponseProps {
  message: Message
  onTap: () => void
}

export default function BrainResponse({ message, onTap }: BrainResponseProps) {
  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 rounded-bl-sm max-w-xs cursor-pointer"
      onClick={onTap}
    >
      <p className="text-sm whitespace-pre-line">{message.content}</p>
      <div className="text-xs text-zinc-600 mt-2 flex items-center gap-1">
        <span>💭</span> Tap to go deeper
      </div>
    </div>
  )
}
