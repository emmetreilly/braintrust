import { createContext, useContext, useEffect, useCallback, ReactNode } from 'react'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useAuthStore } from '../../stores/auth'
import { useChatStore, ThreadMessage, AttachedFile } from '../../stores/chat'
import { groups as groupsApi, messages as messagesApi, brain as brainApi, files as filesApi } from '../../lib/api'
import type { Message, Document } from '../../types'

interface ChatContextValue {
  // WebSocket
  sendWsMessage: (message: object) => void
  isConnected: boolean

  // Team chat actions
  sendTeamMessage: (content: string, attachedFile?: AttachedFile) => Promise<void>
  deleteTeamMessage: (messageId: string) => Promise<void>

  // Brain actions
  sendBrainMessage: (content: string, attachedFiles?: AttachedFile[]) => Promise<void>
  openDocumentInBrain: (doc: Document) => void
  shareToTeamChat: (content: string, sourceType: 'brain' | 'document') => Promise<void>

  // Document actions
  refreshDocuments: () => Promise<void>

  // Data loading
  loadChannelData: (groupId: string) => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return context
}

interface ChatProviderProps {
  groupId: string
  children: ReactNode
}

export function ChatProvider({ groupId, children }: ChatProviderProps) {
  const { user } = useAuthStore()

  const { sendMessage: sendWsMessage, lastMessage, isConnected } = useWebSocket(
    groupId,
    user?.id || ''
  )

  // Load channel data
  const loadChannelData = useCallback(async (gId: string) => {
    const store = useChatStore.getState()

    // Only show loading if this is a different channel
    const isNewChannel = store.groupId !== gId
    if (isNewChannel) {
      // Reset specific state for new channel but don't show loading screen
      store.setGroupId(gId)
      store.setMessages([])
      store.setBrainMessages([])
      store.setDocuments([])
      store.setBrainDocumentContext(null)
      store.setSelectedDocument(null)
      store.setEmbeddedUrl(null)
    }

    try {
      // Load all data in parallel for speed
      const [groupRes, messagesRes, membersRes, filesRes, tagsRes] = await Promise.all([
        groupsApi.get(gId),
        messagesApi.list(gId),
        groupsApi.members(gId),
        filesApi.listByGroup(gId),
        filesApi.listTags(),
      ])

      // Update store all at once
      store.setGroup(groupRes.group)
      store.setMessages(messagesRes.messages)
      store.setMembers(membersRes.members)
      store.setDocuments(filesRes.documents)
      store.setAllTags(tagsRes.tags || [])

      // Load brain thread in background (don't block)
      brainApi.getPrivateThread(gId).then(({ messages: savedBrainMessages }) => {
        if (savedBrainMessages && savedBrainMessages.length > 0) {
          useChatStore.getState().setBrainMessages(savedBrainMessages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })))
        } else {
          useChatStore.getState().setBrainMessages([{
            role: 'brain',
            content: "I'm Brain, your AI assistant. Ask me anything about this channel, the documents shared here, or any topic. I have full context of this conversation.",
          }])
        }
      }).catch(() => {
        useChatStore.getState().setBrainMessages([{
          role: 'brain',
          content: "I'm Brain, your AI assistant. Ask me anything about this channel, the documents shared here, or any topic.",
        }])
      })
    } catch (err) {
      console.error('Failed to load channel data:', err)
    } finally {
      useChatStore.getState().setIsLoading(false)
    }
  }, [])

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    const store = useChatStore.getState()

    if (lastMessage.type === 'message' && lastMessage.message) {
      store.addMessage(lastMessage.message)
    } else if (lastMessage.type === 'presence' && lastMessage.online) {
      store.setOnlineUsers(lastMessage.online)
    } else if (lastMessage.type === 'reaction' && lastMessage.reaction && lastMessage.messageId) {
      store.addReaction(lastMessage.messageId, lastMessage.reaction)
    } else if (lastMessage.type === 'member_added') {
      if (lastMessage.member && groupId) {
        const newMember = lastMessage.member
        const currentMembers = useChatStore.getState().members
        if (!currentMembers.some(m => m.user_id === newMember.user_id)) {
          store.setMembers([...currentMembers, {
            user_id: newMember.user_id,
            group_id: groupId,
            role: newMember.role,
            joined_at: new Date().toISOString(),
            user: {
              id: newMember.user_id,
              email: newMember.email,
              name: newMember.name,
              interests: [],
              created_at: new Date().toISOString(),
            },
          }])
        }
      }
      if (lastMessage.systemMessage) {
        store.addMessage(lastMessage.systemMessage as Message)
      }
    }
  }, [lastMessage, groupId])

  // Load data when groupId changes
  useEffect(() => {
    if (groupId) {
      loadChannelData(groupId)
    }
    // Don't reset on unmount - this causes the black screen flash
  }, [groupId, loadChannelData])

  // Send team message
  const sendTeamMessage = useCallback(async (content: string, attachedFile?: AttachedFile) => {
    if (!groupId || !user) return

    const store = useChatStore.getState()
    const hasBrainMention = content.toLowerCase().includes('@brain') || attachedFile

    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticMessage: Message = {
      id: tempId,
      group_id: groupId,
      user_id: user.id,
      type: 'text',
      content: attachedFile ? `📎 ${attachedFile.name}\n\n${content}` : content,
      created_at: new Date().toISOString(),
      author: user,
      reactions: [],
    }
    store.addMessage(optimisticMessage)

    try {
      // Build media data if file attached
      let mediaData: string | undefined
      if (attachedFile) {
        mediaData = JSON.stringify({
          type: 'file_mention',
          fileId: attachedFile.id,
          fileName: attachedFile.name,
        })
      }

      // Send the message
      const { message: savedMsg } = await messagesApi.send(groupId, content, 'text', mediaData)

      // Replace temp message
      useChatStore.getState().deleteMessage(tempId)
      useChatStore.getState().addMessage(savedMsg)

      // Broadcast via WebSocket
      sendWsMessage({ type: 'message', message: savedMsg })

      // If @brain mentioned, get AI response
      if (hasBrainMention) {
        useChatStore.getState().setBrainLoading(true)
        try {
          const { message: brainResponse } = await brainApi.respond(groupId, savedMsg.id, content)
          useChatStore.getState().addMessage(brainResponse)
          sendWsMessage({ type: 'message', message: brainResponse })

          // Also add to brain thread for continuity
          useChatStore.getState().addBrainMessage({ role: 'user', content })
          useChatStore.getState().addBrainMessage({ role: 'brain', content: brainResponse.content })
        } catch (err) {
          console.error('Brain response error:', err)
        } finally {
          useChatStore.getState().setBrainLoading(false)
        }
      }
    } catch (err) {
      console.error('Send message error:', err)
      useChatStore.getState().deleteMessage(tempId)
    }
  }, [groupId, user, sendWsMessage])

  // Delete team message
  const deleteTeamMessage = useCallback(async (messageId: string) => {
    try {
      await messagesApi.delete(messageId)
      useChatStore.getState().deleteMessage(messageId)
    } catch (err) {
      console.error('Delete message error:', err)
    }
  }, [])

  // Send brain message with streaming (in AI workspace panel)
  const sendBrainMessage = useCallback(async (content: string, attachedFiles?: AttachedFile[]) => {
    if (!groupId) return

    const store = useChatStore.getState()

    // Add user message to brain thread
    const userMessage: ThreadMessage = { role: 'user', content }
    store.addBrainMessage(userMessage)
    store.setBrainLoading(true)

    // Add placeholder for streaming response
    const streamingMessageId = `streaming-${Date.now()}`
    store.addBrainMessage({
      id: streamingMessageId,
      role: 'brain',
      content: '',
    })

    try {
      // Build context from attached files
      let fileContext: string | undefined
      if (attachedFiles && attachedFiles.length > 0) {
        const fileNames = attachedFiles.map(f => f.name).join(', ')
        fileContext = `[User has uploaded files for context: ${fileNames}]`
      }

      // Use the document context if set
      const currentState = useChatStore.getState()
      const effectiveDocId = currentState.brainDocumentContext?.id || (attachedFiles?.[0]?.id)
      const effectiveDocName = currentState.brainDocumentContext?.name || (attachedFiles?.[0]?.name)

      // Try streaming first, fallback to regular
      await brainApi.streamPrivateMessage(
        groupId,
        content,
        // onChunk - update the streaming message
        (chunk: string) => {
          const currentMessages = useChatStore.getState().brainMessages
          const updatedMessages = currentMessages.map(msg =>
            msg.id === streamingMessageId
              ? { ...msg, content: msg.content + chunk }
              : msg
          )
          useChatStore.getState().setBrainMessages(updatedMessages)
        },
        // onComplete - finalize the message
        (fullResponse: string) => {
          const currentMessages = useChatStore.getState().brainMessages
          const updatedMessages = currentMessages.map(msg =>
            msg.id === streamingMessageId
              ? { ...msg, id: `brain-${Date.now()}`, content: fullResponse }
              : msg
          )
          useChatStore.getState().setBrainMessages(updatedMessages)
          useChatStore.getState().setBrainLoading(false)
        },
        // onError - show error message
        (error: Error) => {
          console.error('Brain stream error:', error)
          const currentMessages = useChatStore.getState().brainMessages
          const updatedMessages = currentMessages.map(msg =>
            msg.id === streamingMessageId
              ? { ...msg, content: 'Sorry, I encountered an error. Please try again.' }
              : msg
          )
          useChatStore.getState().setBrainMessages(updatedMessages)
          useChatStore.getState().setBrainLoading(false)
        },
        effectiveDocId,
        effectiveDocName,
        fileContext
      )
    } catch (err) {
      console.error('Brain message error:', err)
      const currentMessages = useChatStore.getState().brainMessages
      const updatedMessages = currentMessages.map(msg =>
        msg.id === streamingMessageId
          ? { ...msg, content: 'Sorry, I encountered an error. Please try again.' }
          : msg
      )
      useChatStore.getState().setBrainMessages(updatedMessages)
      useChatStore.getState().setBrainLoading(false)
    }
  }, [groupId])

  // Open document in brain context
  const openDocumentInBrain = useCallback(async (doc: Document) => {
    const store = useChatStore.getState()
    store.setBrainDocumentContext({ id: doc.id, name: doc.filename })
    store.setSelectedDocument({ id: doc.id, name: doc.filename })

    // Add context message
    store.addBrainMessage({
      role: 'brain',
      content: `I've loaded "${doc.filename}". What would you like to know about it? You can ask me to summarize, find key points, or answer specific questions.`,
    })

    // Try to extract content if not already done
    try {
      await filesApi.extract(doc.id)
    } catch {
      // Ignore extraction errors - content may already exist
    }
  }, [])

  // Share brain response to team chat
  const shareToTeamChat = useCallback(async (content: string, sourceType: 'brain' | 'document') => {
    if (!groupId || !user) return

    const store = useChatStore.getState()
    const docContext = store.brainDocumentContext
    // Just the content, no headers or emoji
    const insightContent = content

    try {
      const mediaData = JSON.stringify({
        type: 'brain_insight',
        source: sourceType,
        documentId: docContext?.id,
        documentName: docContext?.name,
      })

      const { message: savedMsg } = await messagesApi.send(groupId, insightContent, 'brain_insight', mediaData)
      useChatStore.getState().addMessage(savedMsg)
      sendWsMessage({ type: 'message', message: savedMsg })

      // Confirmation in brain thread
      useChatStore.getState().addBrainMessage({
        role: 'brain',
        content: '✓ Shared to the team chat!',
      })
    } catch (err) {
      console.error('Share to chat error:', err)
    }
  }, [groupId, user, sendWsMessage])

  // Refresh documents
  const refreshDocuments = useCallback(async () => {
    if (!groupId) return
    try {
      const filesRes = await filesApi.listByGroup(groupId)
      useChatStore.getState().setDocuments(filesRes.documents)
    } catch (err) {
      console.error('Refresh documents error:', err)
    }
  }, [groupId])

  const value: ChatContextValue = {
    sendWsMessage,
    isConnected,
    sendTeamMessage,
    deleteTeamMessage,
    sendBrainMessage,
    openDocumentInBrain,
    shareToTeamChat,
    refreshDocuments,
    loadChannelData,
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}
