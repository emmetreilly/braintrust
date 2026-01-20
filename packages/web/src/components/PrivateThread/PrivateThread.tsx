import { useState } from 'react'
import { brain } from '../../lib/api'

interface PrivateThreadProps {
  groupId: string
  context: string | null
  onClose: () => void
}

interface ThreadMessage {
  role: 'user' | 'brain'
  content: string
}

const quickPrompts = ['Explain more', 'Draft a reply', 'Search history', 'Find related']

export default function PrivateThread({ groupId, context, onClose }: PrivateThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([
    {
      role: 'brain',
      content:
        "Private thread — only you can see this. I can go deeper on anything, fact-check, help draft a reply, or find related stuff.",
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: ThreadMessage = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const { response } = await brain.private(
        groupId,
        input,
        context || undefined,
        messages.map((m) => ({ role: m.role === 'brain' ? 'assistant' : 'user', content: m.content }))
      )
      setMessages((prev) => [...prev, { role: 'brain', content: response }])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'brain', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setIsLoading(false)
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
        <button onClick={onClose} className="text-zinc-400 hover:text-white">
          ←
        </button>
        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
          🧠
        </div>
        <div>
          <div className="font-medium text-sm">Private thread</div>
          <div className="text-xs text-green-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            End-to-end encrypted · Only you
          </div>
        </div>
      </div>

      {/* Context */}
      {context && (
        <div className="p-3 bg-zinc-900/50 border-b border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Context</div>
          <div className="text-sm text-zinc-400 line-clamp-2">{context}</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3 hide-scrollbar">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {msg.role === 'brain' && (
              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm shrink-0">
                🧠
              </div>
            )}
            <div
              className={`max-w-xs rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-cyan-600 rounded-br-sm'
                  : 'bg-zinc-900 rounded-bl-sm'
              }`}
            >
              <p className="text-sm whitespace-pre-line">{msg.content}</p>
            </div>
          </div>
        ))}
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

      {/* Quick Prompts */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-zinc-900 hide-scrollbar">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => setInput(prompt)}
            className="text-xs bg-zinc-900 px-3 py-2 rounded-full whitespace-nowrap hover:bg-zinc-800 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Brain privately..."
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
