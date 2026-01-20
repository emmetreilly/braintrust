interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onMediaUpload: () => void
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onMediaUpload,
}: ChatInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="p-4 border-t border-zinc-800">
      <div className="flex gap-2">
        <button
          onClick={onMediaUpload}
          className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center text-xl hover:bg-zinc-800 transition-colors"
        >
          +
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message or @brain..."
          className="flex-1 bg-zinc-900 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
        <button
          onClick={onSend}
          disabled={!value.trim()}
          className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center font-bold hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
