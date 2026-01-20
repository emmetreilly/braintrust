import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuthStore } from '../stores/auth'
import { groups as groupsApi, messages as messagesApi, brain as brainApi } from '../lib/api'
import MessageBubble from '../components/Chat/MessageBubble'
import BrainResponse from '../components/Chat/BrainResponse'
import MediaCard from '../components/Chat/MediaCard'
import ChatInput from '../components/Chat/ChatInput'
import QuickActions from '../components/Chat/QuickActions'
import PrivateThread from '../components/PrivateThread/PrivateThread'
import type { Message, Group, GroupMember, MediaData } from '../types'

export default function Chat() {
  const { groupId } = useParams<{ groupId: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [group, setGroup] = useState<Group | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [privateThread, setPrivateThread] = useState<{ context: string | null } | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [brainLoading, setBrainLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showMemorySearch, setShowMemorySearch] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { sendMessage, lastMessage, isConnected } = useWebSocket(
    groupId || '',
    user?.id || ''
  )

  // Load initial data
  useEffect(() => {
    if (!groupId) return

    const loadData = async () => {
      try {
        const [groupRes, messagesRes, membersRes] = await Promise.all([
          groupsApi.get(groupId),
          messagesApi.list(groupId),
          groupsApi.members(groupId),
        ])
        setGroup(groupRes.group)
        setMessages(messagesRes.messages)
        setMembers(membersRes.members)
      } catch (err) {
        console.error('Failed to load chat data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [groupId])

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === 'message' && lastMessage.message) {
      setMessages((prev) => [...prev, lastMessage.message!])
    } else if (lastMessage.type === 'presence' && lastMessage.online) {
      setOnlineUsers(lastMessage.online)
    } else if (lastMessage.type === 'reaction' && lastMessage.reaction) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === lastMessage.messageId
            ? {
                ...msg,
                reactions: [...(msg.reactions || []), lastMessage.reaction!],
              }
            : msg
        )
      )
    }
  }, [lastMessage])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || !groupId || !user) return

    const message: Message = {
      id: crypto.randomUUID(),
      group_id: groupId,
      user_id: user.id,
      type: 'text',
      content: input,
      created_at: new Date().toISOString(),
      author: user,
    }

    // Optimistic update
    setMessages((prev) => [...prev, message])
    setInput('')

    // Send via WebSocket
    sendMessage({ type: 'message', message })

    // Persist to database
    try {
      await messagesApi.send(groupId, input)
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  // Helper to add Brain response to messages
  const addBrainMessage = (content: string) => {
    if (!groupId) return
    const brainMessage: Message = {
      id: crypto.randomUUID(),
      group_id: groupId,
      user_id: `brain-${groupId}`,
      type: 'brain_response',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, brainMessage])
  }

  const handleQuickAction = async (action: string) => {
    if (!groupId) return

    if (action === 'private') {
      setPrivateThread({ context: null })
      return
    }

    if (action === 'memory') {
      setShowMemorySearch(true)
      return
    }

    setBrainLoading(true)
    try {
      let response: { response: string }

      switch (action) {
        case 'catchup':
          response = await brainApi.summarize(groupId, 'catchup')
          break
        case 'weekly':
          response = await brainApi.summarize(groupId, 'weekly')
          break
        case 'factcheck':
          // Get last few messages for fact checking
          const recentContent = messages.slice(-5).map(m => m.content).join('\n')
          response = await brainApi.factCheck(groupId, recentContent)
          break
        case 'recommend':
          response = await brainApi.recommend(groupId, 3)
          break
        default:
          return
      }

      addBrainMessage(response.response)
    } catch (err) {
      console.error('Brain action failed:', err)
      addBrainMessage('Sorry, I encountered an error. Please try again.')
    } finally {
      setBrainLoading(false)
    }
  }

  const handleMemorySearch = async () => {
    if (!groupId || !searchQuery.trim()) return

    setBrainLoading(true)
    setShowMemorySearch(false)
    try {
      const response = await brainApi.searchMemory(groupId, searchQuery)
      addBrainMessage(response.response)
    } catch (err) {
      console.error('Memory search failed:', err)
      addBrainMessage('Sorry, I couldn\'t search my memory. Please try again.')
    } finally {
      setBrainLoading(false)
      setSearchQuery('')
    }
  }

  const handleMessageTap = (message: Message) => {
    if (message.type === 'brain_response') {
      setPrivateThread({ context: message.content })
    }
  }

  const getMember = (userId: string) =>
    members.find((m) => m.user_id === userId)?.user

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    )
  }

  if (privateThread) {
    return (
      <PrivateThread
        groupId={groupId || ''}
        context={privateThread.context}
        onClose={() => setPrivateThread(null)}
      />
    )
  }

  return (
    <div className="bg-black min-h-screen text-white max-w-md mx-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/groups')}
              className="text-zinc-400 hover:text-white"
            >
              ←
            </button>
            <div className="text-2xl">🧠</div>
            <div>
              <h1 className="font-semibold">{group?.name || 'Brain Trust'}</h1>
              <div className="text-xs text-green-500 flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-green-500' : 'bg-zinc-500'
                  }`}
                />
                {isConnected ? 'Connected' : 'Connecting...'} ·{' '}
                {onlineUsers.length || members.length} online
              </div>
            </div>
          </div>
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((member) => (
              <div
                key={member.user_id}
                className="w-8 h-8 rounded-full bg-zinc-700 border-2 border-black flex items-center justify-center text-xs font-medium relative"
              >
                {member.user?.name?.charAt(0) || '?'}
                {onlineUsers.includes(member.user_id) && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-black" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3 hide-scrollbar">
        {messages.map((msg, i) => {
          const author = getMember(msg.user_id)
          const prevMsg = messages[i - 1]
          const samePerson = prevMsg && prevMsg.user_id === msg.user_id
          const isMe = msg.user_id === user?.id
          const isBrain = msg.type === 'brain_response'

          return (
            <div key={msg.id}>
              {!samePerson && !isMe && (
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs">
                    {isBrain ? '🧠' : author?.name?.charAt(0) || '?'}
                  </div>
                  <span className="text-xs text-zinc-500">
                    {isBrain ? 'Brain' : author?.name || 'Unknown'}
                  </span>
                </div>
              )}

              <div className={`${!isMe ? 'ml-8' : 'flex justify-end'}`}>
                {msg.type === 'text' && (
                  <MessageBubble
                    message={msg}
                    isMe={isMe}
                    onTap={() => handleMessageTap(msg)}
                  />
                )}

                {msg.type === 'brain_response' && (
                  <BrainResponse
                    message={msg}
                    onTap={() => handleMessageTap(msg)}
                  />
                )}

                {msg.media_data && (
                  <MediaCard
                    media={JSON.parse(msg.media_data) as MediaData}
                    onTap={() => {}}
                  />
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Brain Loading Indicator */}
      {brainLoading && (
        <div className="px-4 py-2 flex items-center gap-2 text-sm text-cyan-400">
          <div className="animate-pulse">🧠</div>
          <span>Brain is thinking...</span>
        </div>
      )}

      {/* Memory Search Modal */}
      {showMemorySearch && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-4 w-full max-w-md">
            <h3 className="font-medium mb-3">Search Brain's Memory</h3>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="What are you looking for?"
              className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleMemorySearch()}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowMemorySearch(false)
                  setSearchQuery('')
                }}
                className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleMemorySearch}
                disabled={!searchQuery.trim()}
                className="flex-1 bg-cyan-600 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <QuickActions onAction={handleQuickAction} />

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onMediaUpload={() => {}}
      />
    </div>
  )
}
