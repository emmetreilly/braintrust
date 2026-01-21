import { useRef } from 'react'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onFileUpload: (file: File) => void
  isUploading?: boolean
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onFileUpload,
  isUploading,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileUpload(file)
      // Reset input so same file can be selected again
      e.target.value = ''
    }
  }

  return (
    <div className="p-4 border-t border-zinc-800">
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
          accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.pptx,.ppt"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center text-xl hover:bg-zinc-800 transition-colors disabled:opacity-50"
          title="Upload document"
        >
          {isUploading ? (
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
          ) : (
            '+'
          )}
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
