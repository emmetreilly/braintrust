import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuthStore } from '../stores/auth'
import { groups as groupsApi, messages as messagesApi, brain as brainApi, files as filesApi } from '../lib/api'
import MessageBubble from '../components/Chat/MessageBubble'
import BrainResponse from '../components/Chat/BrainResponse'
import ChatInput from '../components/Chat/ChatInput'
import QuickActions from '../components/Chat/QuickActions'
import PrivateThread from '../components/PrivateThread/PrivateThread'
import DocumentPanel from '../components/DocumentPanel/DocumentPanel'
import { FileCardInline } from '../components/Chat/FileCard'
import InsightCard from '../components/Chat/InsightCard'
import ChannelSidebar from '../components/ChannelSidebar'
import type { Message, Group, GroupMember } from '../types'

export default function Chat() {
  const { groupId } = useParams<{ groupId: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [group, setGroup] = useState<Group | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [privateThread, setPrivateThread] = useState<{ context: string | null; documentId?: string; documentName?: string } | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [brainLoading, setBrainLoading] = useState(false)
  const [showDocPanel, setShowDocPanel] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [createError, setCreateError] = useState('')
  const [docPanelCollapsed, setDocPanelCollapsed] = useState(false)

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

  const handleSend = async (attachedFile?: { id: string; filename: string }) => {
    if ((!input.trim() && !attachedFile) || !groupId || !user) return

    const messageContent = input.trim()
    const hasBrainMention = messageContent.toLowerCase().includes('@brain') || attachedFile

    // If a file is attached, include it in the message content for display
    const displayContent = attachedFile
      ? `${messageContent || `Question about "${attachedFile.filename}"`}`
      : messageContent

    const message: Message = {
      id: crypto.randomUUID(),
      group_id: groupId,
      user_id: user.id,
      type: 'text',
      content: displayContent,
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
      const savedMsg = await messagesApi.send(groupId, displayContent)

      // If @brain was mentioned OR a file is attached, trigger Brain response
      if (hasBrainMention) {
        setBrainLoading(true)
        try {
          // If file attached, open private thread with file context instead of public response
          if (attachedFile) {
            setPrivateThread({
              context: messageContent || null,
              documentId: attachedFile.id,
              documentName: attachedFile.filename,
            })
          } else {
            const brainResponse = await brainApi.respond(groupId, savedMsg.message.id, messageContent)
            setMessages((prev) => [...prev, brainResponse.message])
            sendMessage({ type: 'message', message: brainResponse.message })
          }
        } catch (err) {
          console.error('Brain failed to respond:', err)
          addBrainMessage("Sorry, I encountered an error. Please try again.")
        } finally {
          setBrainLoading(false)
        }
      }
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

    if (action === 'catchup') {
      setBrainLoading(true)
      try {
        const response = await brainApi.summarize(groupId, 'catchup')
        addBrainMessage(response.response)
      } catch (err) {
        console.error('Catchup failed:', err)
        addBrainMessage('Sorry, I encountered an error. Please try again.')
      } finally {
        setBrainLoading(false)
      }
    }
  }

  const handleMessageTap = (message: Message) => {
    if (message.type === 'brain_response') {
      setPrivateThread({ context: message.content })
    }
  }

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await messagesApi.delete(messageId)
      // Remove from local state
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    } catch (err) {
      console.error('Failed to delete message:', err)
    }
  }

  // Handle public follow-up question on a shared insight
  const handleFollowup = async (parentMessageId: string, question: string) => {
    if (!groupId) return

    setBrainLoading(true)
    try {
      const { questionMessage, responseMessage } = await brainApi.followup(groupId, parentMessageId, question)

      // Add both messages to state
      setMessages((prev) => [...prev, questionMessage, responseMessage])

      // Broadcast via WebSocket
      sendMessage({ type: 'message', message: questionMessage })
      sendMessage({ type: 'message', message: responseMessage })
    } catch (err) {
      console.error('Follow-up failed:', err)
      addBrainMessage('Sorry, I encountered an error. Please try again.')
    } finally {
      setBrainLoading(false)
    }
  }

  const getMember = (userId: string) =>
    members.find((m) => m.user_id === userId)?.user

  const handleFileUpload = async (file: File) => {
    if (!groupId || !user) return

    setIsUploading(true)
    try {
      // First upload the file
      const result = await filesApi.upload(file)

      // Show processing message
      addBrainMessage(`Processing "${result.document.filename}"... I'm reading and summarizing it for the group.`)

      // Then share it to the group with summarization
      const shareResult = await filesApi.shareToGroup(result.document.id, groupId, true)

      // Add the message to the chat
      setMessages((prev) => [...prev, shareResult.message])
      sendMessage({ type: 'message', message: shareResult.message })

      // Confirm it's indexed
      if (shareResult.summary) {
        addBrainMessage(`Done! I've read and indexed "${result.document.filename}". Everyone can now ask me questions about it using @brain.`)
      } else {
        addBrainMessage(`I've shared "${result.document.filename}". You can ask me questions about it using @brain.`)
      }
    } catch (err) {
      console.error('File upload failed:', err)
      addBrainMessage(`Sorry, I couldn't upload that file. ${err instanceof Error ? err.message : 'Please try again.'}`)
    } finally {
      setIsUploading(false)
    }
  }

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')

    try {
      const { group } = await groupsApi.create(newChannelName)
      setNewChannelName('')
      setShowCreateChannel(false)
      navigate(`/chat/${group.id}`)
    } catch (err) {
      setCreateError((err as Error).message)
    }
  }

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
        documentId={privateThread.documentId}
        documentName={privateThread.documentName}
        onClose={() => setPrivateThread(null)}
        onShareInsight={() => {
          // Reload messages to show the shared insight
          if (groupId) {
            messagesApi.list(groupId).then((res) => setMessages(res.messages))
          }
        }}
      />
    )
  }

  return (
    <div className="bg-black min-h-screen text-white flex">
      {/* Channel Sidebar - Desktop only */}
      <div className="hidden lg:flex">
        <ChannelSidebar onCreateChannel={() => setShowCreateChannel(true)} />
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${docPanelCollapsed ? '' : 'lg:mr-80'}`}>
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/groups')}
              className="text-zinc-400 hover:text-white lg:hidden"
            >
              ←
            </button>
            <span className="text-zinc-500 text-xl">#</span>
            <div>
              <h1 className="font-semibold">{group?.name?.toLowerCase().replace(/\s+/g, '-') || 'channel'}</h1>
              <div className="text-xs text-zinc-500 flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-green-500' : 'bg-zinc-500'
                  }`}
                />
                {isConnected ? 'Connected' : 'Connecting...'} ·{' '}
                {onlineUsers.length || members.length} members
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            {/* Mobile: open doc panel overlay */}
            <button
              onClick={() => setShowDocPanel(true)}
              className="lg:hidden w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white"
              title="Deal Room"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
            {/* Desktop: toggle doc panel */}
            <button
              onClick={() => setDocPanelCollapsed(!docPanelCollapsed)}
              className="hidden lg:flex w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 items-center justify-center text-zinc-400 hover:text-white"
              title={docPanelCollapsed ? 'Show Deal Room' : 'Hide Deal Room'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
            <button
              onClick={() => navigate(`/settings/${groupId}`)}
              className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white"
              title="Channel Settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3 hide-scrollbar">
        {messages
          // Filter out messages that are replies (they'll be shown under their parent)
          .filter((msg) => !msg.parent_message_id)
          .map((msg, i, filteredMsgs) => {
          const author = getMember(msg.user_id)
          const prevMsg = filteredMsgs[i - 1]
          const samePerson = prevMsg && prevMsg.user_id === msg.user_id
          const isMe = msg.user_id === user?.id
          const isBrain = msg.type === 'brain_response'

          // Get replies for this message
          const replies = messages.filter((m) => m.parent_message_id === msg.id)

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
                    onDelete={isMe ? () => handleDeleteMessage(msg.id) : undefined}
                  />
                )}

                {msg.type === 'brain_response' && (
                  <BrainResponse
                    message={msg}
                    onTap={() => handleMessageTap(msg)}
                    onShare={(sharedMsg) => {
                      // Update the message in state to remove visible_to
                      setMessages(prev => prev.map(m =>
                        m.id === sharedMsg.id ? { ...m, visible_to: undefined } : m
                      ))
                      // Broadcast to other users via WebSocket
                      sendMessage({ type: 'message', message: { ...msg, visible_to: undefined } })
                    }}
                  />
                )}

                {msg.type === 'brain_insight' && (() => {
                  // Parse documentId from media_data if present so others can continue the conversation
                  let docId: string | undefined
                  let docName: string | undefined
                  if (msg.media_data) {
                    try {
                      const mediaData = JSON.parse(msg.media_data)
                      if (mediaData.type === 'insight' && mediaData.documentId) {
                        docId = mediaData.documentId
                        docName = mediaData.documentName
                      }
                    } catch { /* ignore parse errors */ }
                  }
                  return (
                    <InsightCard
                      content={msg.content}
                      authorName={author?.name}
                      documentName={docName}
                      onFollowup={(question) => handleFollowup(msg.id, question)}
                      onClick={() => {
                        setPrivateThread({
                          context: msg.content,
                          documentId: docId,
                          documentName: docName,
                        })
                      }}
                    />
                  )
                })()}

                {msg.media_data && (() => {
                  try {
                    const mediaData = JSON.parse(msg.media_data!)

                    // File upload
                    if (mediaData.type === 'file') {
                      return (
                        <FileCardInline
                          filename={mediaData.filename}
                          fileSize={mediaData.fileSize}
                          fileType={mediaData.fileType}
                          documentId={mediaData.documentId}
                          summary={mediaData.summary}
                          onAskBrain={() => setPrivateThread({
                            context: `I want to ask about the document "${mediaData.filename}"`,
                            documentId: mediaData.documentId,
                            documentName: mediaData.filename,
                          })}
                        />
                      )
                    }

                    return null
                  } catch {
                    return null
                  }
                })()}
              </div>

              {/* Threaded replies */}
              {replies.length > 0 && (
                <div className="ml-8 mt-2 border-l-2 border-cyan-500/30 pl-4 space-y-2">
                  {replies.map((reply) => {
                    const replyAuthor = getMember(reply.user_id)
                    const isReplyBrain = reply.type === 'brain_response'
                    const isReplyMe = reply.user_id === user?.id

                    return (
                      <div key={reply.id} className="flex gap-2">
                        <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-xs shrink-0">
                          {isReplyBrain ? '🧠' : replyAuthor?.name?.charAt(0) || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium text-zinc-400">
                              {isReplyBrain ? 'Brain' : replyAuthor?.name || 'Unknown'}
                            </span>
                            <span className="text-xs text-zinc-600">
                              {new Date(reply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div
                            className={`rounded-lg px-3 py-2 text-sm ${
                              isReplyBrain
                                ? 'bg-zinc-900 border border-zinc-800'
                                : isReplyMe
                                ? 'bg-cyan-600'
                                : 'bg-zinc-800'
                            }`}
                          >
                            <p className="whitespace-pre-line">{reply.content}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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

      {/* Quick Actions */}
      <QuickActions onAction={handleQuickAction} />

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onFileUpload={handleFileUpload}
        isUploading={isUploading}
        groupId={groupId}
      />
      </div>

      {/* Document Panel - Mobile overlay or Desktop sidebar */}
      {groupId && (
        <>
          {/* Mobile: overlay when opened */}
          {showDocPanel && (
            <div className="lg:hidden fixed inset-0 z-40 flex">
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-black/60"
                onClick={() => setShowDocPanel(false)}
              />
              {/* Panel */}
              <div className="absolute inset-y-0 right-0 w-80 max-w-[85vw]">
                <DocumentPanel
                  groupId={groupId}
                  onDocumentSelect={(doc) => {
                    // Open private thread to ask about the document
                    setPrivateThread({
                      context: null,
                      documentId: doc.id,
                      documentName: doc.filename,
                    })
                    setShowDocPanel(false)
                  }}
                  onClose={() => setShowDocPanel(false)}
                />
              </div>
            </div>
          )}
          {/* Desktop: collapsible sidebar */}
          <div className={`hidden lg:block fixed inset-y-0 right-0 w-80 z-30 transition-transform duration-300 ${docPanelCollapsed ? 'translate-x-full' : ''}`}>
            <DocumentPanel
              groupId={groupId}
              onDocumentSelect={(doc) => {
                // Open private thread to ask about the document
                setPrivateThread({
                  context: null,
                  documentId: doc.id,
                  documentName: doc.filename,
                })
              }}
              onClose={() => setDocPanelCollapsed(true)}
            />
          </div>
        </>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Create Channel</h2>
            <form onSubmit={handleCreateChannel}>
              <div className="mb-4">
                <label className="text-sm text-zinc-400 block mb-2">Channel name</label>
                <div className="flex items-center bg-zinc-800 rounded-lg">
                  <span className="pl-4 text-zinc-500">#</span>
                  <input
                    type="text"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="sales-team"
                    className="flex-1 bg-transparent px-2 py-3 text-sm focus:outline-none"
                    required
                    autoFocus
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Channels are where your team communicates. Create one for each project, topic, or team.
                </p>
              </div>
              {createError && <p className="text-red-500 text-sm mb-4">{createError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateChannel(false)
                    setNewChannelName('')
                    setCreateError('')
                  }}
                  className="flex-1 bg-zinc-800 rounded-lg py-2.5 text-sm hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200 transition-colors"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
