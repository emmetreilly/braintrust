import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDrop } from 'react-dnd'
import { useChatStore } from '../../stores/chat'
import { useChatContext } from './ChatContext'
import { useAuthStore } from '../../stores/auth'
import { groups as groupsApi, files as filesApi, brain as brainApi } from '../../lib/api'
import { DragTypes, BrainDragItem } from '../ui/DragDropContext'
import MessageBubble from './MessageBubble'
import BrainResponse from './BrainResponse'
import ChatInput from './ChatInput'
import QuickActions from './QuickActions'
import InsightCard from './InsightCard'
import { FileCardInline } from './FileCard'
import type { Message } from '../../types'

interface TeamChatPanelProps {
  onShowShareModal: () => void
  onOpenLinkInBrain?: (url: string) => void
}

export default function TeamChatPanel({ onShowShareModal, onOpenLinkInBrain }: TeamChatPanelProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const {
    groupId, group, members, onlineUsers, messages,
    brainLoading, setBrainLoading, addMessage, setMessages
  } = useChatStore()
  const { sendTeamMessage, isConnected, sendWsMessage, deleteTeamMessage, refreshDocuments } = useChatContext()

  const [input, setInput] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [workspaceUsers, setWorkspaceUsers] = useState<{ id: string; name: string; email: string; avatar_url?: string }[]>([])
  const [invitingUser, setInvitingUser] = useState<string | null>(null)
  const [droppingBrainResponse, setDroppingBrainResponse] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Handle dropping Brain response into chat
  const handleDropBrainResponse = async (item: BrainDragItem) => {
    if (!groupId || !user) return
    setDroppingBrainResponse(true)
    try {
      // Create a brain_insight message to share with the team
      const insightMessage: Message = {
        id: crypto.randomUUID(),
        group_id: groupId,
        user_id: user.id,
        type: 'brain_insight',
        content: item.content,
        media_data: item.documentContext ? JSON.stringify({
          type: 'insight',
          documentName: item.documentContext.name,
          documentId: item.documentContext.id,
        }) : undefined,
        created_at: new Date().toISOString(),
      }
      addMessage(insightMessage)
      sendWsMessage({ type: 'message', message: insightMessage })
    } catch (err) {
      console.error('Failed to share brain response:', err)
    } finally {
      setDroppingBrainResponse(false)
    }
  }

  // Drop zone for Brain responses
  const [{ isOver, canDrop }, drop] = useDrop<BrainDragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DragTypes.BRAIN_RESPONSE,
    drop: (item) => {
      handleDropBrainResponse(item)
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [groupId, user])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (attachedFile?: { id: string; filename: string }) => {
    if ((!input.trim() && !attachedFile) || !groupId || !user) return

    const messageContent = input.trim()
    setInput('')

    await sendTeamMessage(messageContent, attachedFile ? { id: attachedFile.id, name: attachedFile.filename } : undefined)
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
    addMessage(brainMessage)
  }

  const handleDeleteMessage = async (messageId: string) => {
    await deleteTeamMessage(messageId)
  }

  const handleFileUpload = async (file: File) => {
    if (!groupId || !user) return

    setIsUploading(true)
    try {
      const result = await filesApi.upload(file)
      addBrainMessage(`Processing "${result.document.filename}"... I'm reading and summarizing it for the group.`)

      const shareResult = await filesApi.shareToGroup(result.document.id, groupId, true)
      addMessage(shareResult.message)
      sendWsMessage({ type: 'message', message: shareResult.message })
      refreshDocuments()

      if (shareResult.summary) {
        addBrainMessage(`Done! I've read and indexed "${result.document.filename}". Everyone can now ask me questions about it.`)
      } else {
        addBrainMessage(`I've shared "${result.document.filename}". You can ask me questions about it.`)
      }
    } catch (err) {
      console.error('File upload failed:', err)
      addBrainMessage(`Sorry, I couldn't upload that file. ${err instanceof Error ? err.message : 'Please try again.'}`)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFollowup = async (parentMessageId: string, question: string) => {
    if (!groupId) return

    setBrainLoading(true)
    try {
      const { questionMessage, responseMessage } = await brainApi.followup(groupId, parentMessageId, question)
      addMessage(questionMessage)
      addMessage(responseMessage)
      sendWsMessage({ type: 'message', message: questionMessage })
      sendWsMessage({ type: 'message', message: responseMessage })
    } catch (err) {
      console.error('Follow-up failed:', err)
      addBrainMessage('Sorry, I encountered an error. Please try again.')
    } finally {
      setBrainLoading(false)
    }
  }

  const openInviteModal = async () => {
    if (!groupId) return
    setShowInviteModal(true)
    try {
      const { users } = await groupsApi.workspaceUsers(groupId)
      setWorkspaceUsers(users)
    } catch (err) {
      console.error('Failed to load workspace users:', err)
    }
  }

  const handleInviteUser = async (userId: string) => {
    if (!groupId) return
    setInvitingUser(userId)
    try {
      const { member } = await groupsApi.invite(groupId, userId)
      useChatStore.getState().setMembers([...members, {
        group_id: groupId,
        user_id: member.user_id,
        role: member.role,
        joined_at: new Date().toISOString(),
        user: {
          id: member.user_id,
          email: member.email,
          name: member.name,
          interests: [],
          created_at: '',
        },
      }])
      setWorkspaceUsers(prev => prev.filter(u => u.id !== userId))
    } catch (err) {
      console.error('Failed to invite user:', err)
    } finally {
      setInvitingUser(null)
    }
  }

  const getMember = (userId: string) => members.find((m) => m.user_id === userId)?.user

  return (
    <div
      ref={drop}
      className={`flex-1 flex flex-col h-screen overflow-hidden transition-colors ${
        isOver && canDrop ? 'bg-cyan-950/20 ring-2 ring-inset ring-cyan-500/50' : ''
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex-shrink-0">
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
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-zinc-500'}`} />
                {isConnected ? 'Connected' : 'Connecting...'} · {onlineUsers.length || members.length} members
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Members avatars */}
            <button
              onClick={openInviteModal}
              className="flex -space-x-2 hover:opacity-80 transition-opacity"
              title="Manage members"
            >
              {members.slice(0, 4).map((member) => (
                <div
                  key={member.user_id}
                  className="w-7 h-7 rounded-full bg-zinc-700 border-2 border-black flex items-center justify-center text-xs font-medium relative"
                >
                  {member.user?.name?.charAt(0) || '?'}
                  {onlineUsers.includes(member.user_id) && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-black" />
                  )}
                </div>
              ))}
              <div className="w-7 h-7 rounded-full bg-zinc-800 border-2 border-black flex items-center justify-center text-xs text-zinc-400">
                +
              </div>
            </button>
            <button
              onClick={onShowShareModal}
              className="px-3 py-1.5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
            >
              + Share
            </button>
            <button
              onClick={() => navigate(`/settings/${groupId}`)}
              className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white"
              title="Settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Drop zone indicator */}
      {(isOver && canDrop) && (
        <div className="px-4 py-2 bg-cyan-500/20 text-cyan-400 text-xs text-center border-b border-cyan-500/30">
          Drop to share with team
        </div>
      )}

      {/* Sharing indicator */}
      {droppingBrainResponse && (
        <div className="px-4 py-2 bg-zinc-800 text-zinc-400 text-xs text-center border-b border-zinc-700">
          Sharing...
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3 hide-scrollbar">
        {messages
          .filter((msg) => !msg.parent_message_id)
          .map((msg, i, filteredMsgs) => {
            const author = getMember(msg.user_id)
            const prevMsg = filteredMsgs[i - 1]
            const samePerson = prevMsg && prevMsg.user_id === msg.user_id
            const isMe = msg.user_id === user?.id
            const isBrain = msg.type === 'brain_response'
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
                      authorName={isBrain ? 'Brain' : author?.name}
                      onDelete={isMe ? () => handleDeleteMessage(msg.id) : undefined}
                      onOpenLink={onOpenLinkInBrain}
                    />
                  )}

                  {msg.type === 'brain_response' && (
                    <BrainResponse
                      message={msg}
                      onTap={() => {}}
                      onShare={(sharedMsg) => {
                        setMessages(messages.map(m =>
                          m.id === sharedMsg.id ? { ...m, visible_to: undefined } : m
                        ))
                        sendWsMessage({ type: 'message', message: { ...msg, visible_to: undefined } })
                      }}
                    />
                  )}

                  {msg.type === 'brain_insight' && (() => {
                    let docName: string | undefined
                    if (msg.media_data) {
                      try {
                        const mediaData = JSON.parse(msg.media_data)
                        if (mediaData.type === 'insight' && mediaData.documentName) {
                          docName = mediaData.documentName
                        }
                      } catch {}
                    }
                    return (
                      <InsightCard
                        content={msg.content}
                        authorName={author?.name}
                        documentName={docName}
                        onFollowup={(question) => handleFollowup(msg.id, question)}
                        onClick={() => {}}
                      />
                    )
                  })()}

                  {msg.type === 'system' && (
                    <div className="flex justify-center my-2">
                      <span className="text-xs text-zinc-500 bg-zinc-800/50 px-3 py-1 rounded-full">
                        {msg.content}
                      </span>
                    </div>
                  )}

                  {msg.media_data && (() => {
                    try {
                      const mediaData = JSON.parse(msg.media_data!)
                      if (mediaData.type === 'file') {
                        return (
                          <FileCardInline
                            filename={mediaData.filename}
                            fileSize={mediaData.fileSize}
                            fileType={mediaData.fileType}
                            documentId={mediaData.documentId}
                            summary={mediaData.summary}
                            onAskBrain={() => {
                              useChatStore.getState().setBrainDocumentContext({
                                id: mediaData.documentId,
                                name: mediaData.filename,
                              })
                            }}
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
                            </div>
                            <div className={`rounded-lg px-3 py-2 text-sm ${
                              isReplyBrain ? 'bg-zinc-900 border border-zinc-800' :
                              isReplyMe ? 'bg-cyan-600' : 'bg-zinc-800'
                            }`}>
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

      {/* Brain Loading */}
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
        groupId={groupId || undefined}
      />

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Invite to #{group?.name?.toLowerCase().replace(/\s+/g, '-')}</h2>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {workspaceUsers.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-4">
                Everyone in your workspace is already in this channel!
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto">
                {workspaceUsers.map(u => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-zinc-800"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-sm">
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-zinc-500">{u.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleInviteUser(u.id)}
                      disabled={invitingUser === u.id}
                      className="px-3 py-1.5 bg-cyan-500 text-black rounded-lg text-xs font-medium hover:bg-cyan-400 disabled:opacity-50"
                    >
                      {invitingUser === u.id ? '...' : 'Invite'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowInviteModal(false)}
              className="w-full mt-4 bg-zinc-800 rounded-lg py-2.5 text-sm hover:bg-zinc-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
