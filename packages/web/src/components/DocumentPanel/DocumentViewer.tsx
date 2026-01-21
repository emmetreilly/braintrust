import { useState, useEffect, useRef } from 'react'
import { documents as docsApi } from '../../lib/api'
import type { ClaudeDocument, ConversationMessage } from '../../types'
import { formatDistanceToNow } from 'date-fns'

interface DocumentViewerProps {
  documentId: string
  onClose: () => void
  onShared?: () => void
}

export default function DocumentViewer({ documentId, onClose, onShared }: DocumentViewerProps) {
  const [document, setDocument] = useState<ClaudeDocument | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadDocument()
  }, [documentId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [document?.conversation_history])

  const loadDocument = async () => {
    try {
      const res = await docsApi.get(documentId)
      setDocument(res.document)
    } catch (err) {
      console.error('Failed to load document:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !document) return

    setIsSending(true)
    try {
      const res = await docsApi.continue(documentId, input)
      setDocument((prev) =>
        prev
          ? { ...prev, conversation_history: res.conversation_history }
          : prev
      )
      setInput('')
    } catch (err) {
      console.error('Failed to continue conversation:', err)
      alert('Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  const handleShare = async () => {
    if (!document) return

    setIsSharing(true)
    try {
      await docsApi.share(documentId)
      setDocument((prev) => (prev ? { ...prev, is_shared: true } : prev))
      onShared?.()
    } catch (err) {
      console.error('Failed to share document:', err)
      alert('Failed to share document')
    } finally {
      setIsSharing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="text-zinc-500">Loading...</div>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="text-zinc-500">Document not found</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
          >
            &larr;
          </button>
          <div>
            <h2 className="font-semibold">{document.title}</h2>
            <p className="text-xs text-zinc-500">
              By {document.creator_name} &middot;{' '}
              {formatDistanceToNow(new Date(document.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {document.is_shared ? (
            <span className="text-xs bg-green-600/20 text-green-400 px-2 py-1 rounded">
              Shared
            </span>
          ) : (
            <button
              onClick={handleShare}
              disabled={isSharing}
              className="text-sm bg-cyan-600 hover:bg-cyan-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {isSharing ? 'Sharing...' : 'Share to Chat'}
            </button>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {document.conversation_history?.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Continue the conversation..."
            className="flex-1 bg-zinc-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={isSending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            className="bg-cyan-600 hover:bg-cyan-700 px-4 rounded-lg disabled:opacity-50"
          >
            {isSending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: ConversationMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-cyan-600 text-white'
            : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {!isUser && (
          <div className="text-xs text-cyan-400 mb-1 font-medium">Claude</div>
        )}
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        <div className="text-xs opacity-50 mt-1 text-right">
          {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
        </div>
      </div>
    </div>
  )
}
