import { useState, useEffect } from 'react'
import { brain, messages as messagesApi } from '../../lib/api'

interface PrivateThreadProps {
  groupId: string
  context: string | null
  documentId?: string
  documentName?: string
  onClose: () => void
  onShareInsight?: (insight: string) => void
}

interface ThreadMessage {
  id?: string
  role: 'user' | 'brain'
  content: string
}

export default function PrivateThread({ groupId, context, documentId, documentName, onClose, onShareInsight }: PrivateThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingThread, setIsLoadingThread] = useState(true)
  const [selectedMessage, setSelectedMessage] = useState<number | null>(null)
  const [sharing, setSharing] = useState(false)

  // Load existing thread on mount
  useEffect(() => {
    const loadThread = async () => {
      try {
        const { messages: savedMessages } = await brain.getPrivateThread(groupId, documentId)

        if (savedMessages && savedMessages.length > 0) {
          // Load persisted messages
          setMessages(savedMessages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })))
          setIsLoadingThread(false)
        } else {
          // New thread - show welcome and auto-send context if provided
          setMessages([{
            role: 'brain',
            content: documentName
              ? `I've loaded "${documentName}". What would you like to know about it? You can ask me to summarize, find key points, or answer specific questions.`
              : "Private thread — only you can see this. I can go deeper on anything, fact-check, help draft a reply, or find related stuff.",
          }])
          setIsLoadingThread(false)

          // If context was provided (user typed a question before opening thread), auto-send it
          if (context && context.trim()) {
            // Use setTimeout to let state settle before auto-sending
            setTimeout(() => {
              setInput(context)
            }, 100)
          }
        }
      } catch (err) {
        console.error('Failed to load thread:', err)
        // Show welcome message on error
        setMessages([{
          role: 'brain',
          content: documentName
            ? `I've loaded "${documentName}". What would you like to know about it?`
            : "Private thread — only you can see this. How can I help?",
        }])
        setIsLoadingThread(false)
      }
    }

    loadThread()
  }, [groupId, documentId, documentName, context])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: ThreadMessage = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Use persistent thread API
      const { userMessage: savedUserMsg, brainMessage } = await brain.sendPrivateMessage(
        groupId,
        input,
        documentId,
        documentName,
        context || undefined
      )

      // Update with actual saved messages (with IDs)
      setMessages((prev) => {
        const updated = [...prev]
        // Update the last user message with the saved ID
        if (updated.length > 0 && updated[updated.length - 1].role === 'user') {
          updated[updated.length - 1].id = savedUserMsg.id
        }
        // Add brain response
        updated.push({
          id: brainMessage.id,
          role: 'brain',
          content: brainMessage.content,
        })
        return updated
      })
    } catch (err) {
      console.error('Failed to send message:', err)
      setMessages((prev) => [
        ...prev,
        { role: 'brain', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleShareToGroup = async (messageIndex: number) => {
    const message = messages[messageIndex]
    if (!message || message.role !== 'brain') return

    setSharing(true)
    try {
      // Create an insight message in the group chat
      const insightContent = documentName
        ? `🧠 **Brain insight about "${documentName}":**\n\n${message.content}`
        : `🧠 **Brain insight:**\n\n${message.content}`

      // Include documentId in media_data so others can continue the conversation about this document
      const mediaData = documentId
        ? JSON.stringify({ type: 'insight', documentId, documentName })
        : undefined

      await messagesApi.send(groupId, insightContent, 'brain_insight', mediaData)

      if (onShareInsight) {
        onShareInsight(message.content)
      }

      setSelectedMessage(null)
      // Show success feedback
      setMessages((prev) => [
        ...prev,
        { role: 'brain', content: '✓ Shared to the group chat! Everyone can see this insight now.' },
      ])
    } catch (err) {
      console.error('Failed to share insight:', err)
      setMessages((prev) => [
        ...prev,
        { role: 'brain', content: 'Sorry, I couldn\'t share that. Please try again.' },
      ])
    } finally {
      setSharing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="bg-zinc-950 min-h-screen text-white max-w-md mx-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
        >
          ←
        </button>
        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
          🧠
        </div>
        <div className="flex-1">
          <div className="font-medium text-sm">
            {documentName ? `Brain · ${documentName}` : 'Private thread'}
          </div>
          <div className="text-xs text-green-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            Private · Only you can see this
          </div>
        </div>
      </div>

      {/* Context */}
      {context && !documentName && (
        <div className="p-3 bg-zinc-900/50 border-b border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Context</div>
          <div className="text-sm text-zinc-400 line-clamp-2">{context}</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3 hide-scrollbar">
        {isLoadingThread ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {msg.role === 'brain' && (
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm shrink-0">
                  🧠
                </div>
              )}
              <div className="flex flex-col gap-1">
                <div
                  onClick={() => msg.role === 'brain' && i > 0 && setSelectedMessage(selectedMessage === i ? null : i)}
                  className={`max-w-xs rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-cyan-600 rounded-br-sm'
                      : 'bg-zinc-900 rounded-bl-sm cursor-pointer hover:bg-zinc-800/80'
                  } ${selectedMessage === i ? 'ring-2 ring-cyan-500' : ''}`}
                >
                  <p className="text-sm whitespace-pre-line">{msg.content}</p>
                </div>
                {/* Share button for selected Brain messages */}
                {selectedMessage === i && msg.role === 'brain' && i > 0 && (
                  <button
                    onClick={() => handleShareToGroup(i)}
                    disabled={sharing}
                    className="self-start ml-10 flex items-center gap-1.5 text-xs bg-cyan-500/20 text-cyan-400 px-3 py-1.5 rounded-full hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
                  >
                    {sharing ? (
                      'Sharing...'
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        Share to group
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
              🧠
            </div>
            <div className="bg-zinc-900 rounded-2xl px-4 py-3 rounded-bl-sm">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" />
                <div
                  className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"
                  style={{ animationDelay: '0.1s' }}
                />
                <div
                  className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={documentName ? `Ask about ${documentName}...` : 'Ask Brain privately...'}
            className="flex-1 bg-zinc-900 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center font-bold disabled:opacity-50 hover:bg-zinc-200 transition-colors"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
