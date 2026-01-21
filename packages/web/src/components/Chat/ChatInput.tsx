import { useRef, useState, useEffect } from 'react'
import FileMentionPicker from './FileMentionPicker'
import type { Document } from '../../types'

interface AttachedFile {
  id: string
  filename: string
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: (attachedFile?: AttachedFile) => void
  onFileUpload: (file: File) => void
  isUploading?: boolean
  groupId?: string
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onFileUpload,
  isUploading,
  groupId,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null)

  // Detect @ trigger in input - show file picker when typing @ (but not @brain)
  useEffect(() => {
    // Match @ followed by optional word characters, but not if it's @brain
    // Examples: "@" -> show picker, "@ne" -> show picker filtering "ne", "@brain" -> don't show
    const atMatch = value.match(/@(\w*)$/)

    if (atMatch && groupId) {
      const query = atMatch[1] || ''
      // Don't show picker if typing @brain
      if (query.toLowerCase().startsWith('brain')) {
        setShowFilePicker(false)
        return
      }
      setShowFilePicker(true)
      setFileQuery(query)
    } else {
      setShowFilePicker(false)
    }
  }, [value, groupId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't handle Enter if file picker is open (picker handles it)
    if (showFilePicker && (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }

    // Remove attached file on backspace when input is empty
    if (e.key === 'Backspace' && value === '' && attachedFile) {
      setAttachedFile(null)
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

  const handleFileSelect = (doc: Document) => {
    // Remove the @query from input
    const newValue = value.replace(/@\w*$/, '').trim()
    onChange(newValue)

    // Attach the file
    setAttachedFile({ id: doc.id, filename: doc.filename })
    setShowFilePicker(false)

    // Focus back on input
    textInputRef.current?.focus()
  }

  const handleSend = () => {
    if (!value.trim() && !attachedFile) return
    onSend(attachedFile || undefined)
    setAttachedFile(null)
  }

  return (
    <div className="p-4 border-t border-zinc-800 relative">
      {/* Attached file indicator */}
      {attachedFile && (
        <div className="mb-2 flex items-center gap-2">
          <div className="bg-cyan-500/20 text-cyan-400 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
            <span>📎</span>
            <span className="truncate max-w-[200px]">{attachedFile.filename}</span>
            <button
              onClick={() => setAttachedFile(null)}
              className="ml-1 hover:text-white"
            >
              ✕
            </button>
          </div>
          <span className="text-xs text-zinc-500">Brain will have context from this file</span>
        </div>
      )}

      {/* File picker dropdown */}
      {showFilePicker && groupId && (
        <FileMentionPicker
          groupId={groupId}
          query={fileQuery}
          onSelect={handleFileSelect}
          onClose={() => setShowFilePicker(false)}
        />
      )}

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
          ref={textInputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={attachedFile ? `Ask about ${attachedFile.filename}...` : 'Message, @brain, or @file...'}
          className="flex-1 bg-zinc-900 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() && !attachedFile}
          className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center font-bold hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
