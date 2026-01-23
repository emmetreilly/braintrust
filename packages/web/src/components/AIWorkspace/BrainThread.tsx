import { useState, useRef, useEffect } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { useChatStore, AttachedFile } from '../../stores/chat'
import { useChatContext } from '../Chat/ChatContext'
import { useAuthStore } from '../../stores/auth'
import { files as filesApi } from '../../lib/api'
import { DragTypes, BrainDragItem, MessageDragItem, FileDragItem } from '../ui/DragDropContext'
import WebEmbed from './WebEmbed'

interface DraggableBrainMessageProps {
  content: string
  index: number
  documentContext?: { id: string; name: string } | null
  isSelected: boolean
  onSelect: () => void
  onShare: () => void
  sharing: boolean
  onLinkClick: (url: string) => void
}

function DraggableBrainMessage({
  content,
  index,
  documentContext,
  isSelected,
  onSelect,
  onShare,
  sharing,
  onLinkClick,
}: DraggableBrainMessageProps) {
  const [{ isDragging }, drag] = useDrag<BrainDragItem, void, { isDragging: boolean }>(() => ({
    type: DragTypes.BRAIN_RESPONSE,
    item: {
      type: DragTypes.BRAIN_RESPONSE,
      content,
      documentContext: documentContext || undefined,
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [content, documentContext])

  // Extract URLs from content
  const extractUrls = (text: string): string[] => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return text.match(urlRegex) || []
  }

  const isEmbeddableUrl = (url: string): boolean => {
    const embeddable = ['youtube.com', 'youtu.be', 'vimeo.com']
    return embeddable.some(domain => url.includes(domain))
  }

  // Render content with clickable links
  const renderContent = () => {
    const urls = extractUrls(content)
    if (urls.length === 0) {
      return <p className="whitespace-pre-line text-sm leading-relaxed">{content}</p>
    }

    let lastIndex = 0
    const parts: React.ReactNode[] = []
    urls.forEach((url, i) => {
      const urlIndex = content.indexOf(url, lastIndex)
      if (urlIndex > lastIndex) {
        parts.push(<span key={`text-${i}`}>{content.slice(lastIndex, urlIndex)}</span>)
      }
      parts.push(
        <button
          key={`url-${i}`}
          onClick={(e) => {
            e.stopPropagation()
            onLinkClick(url)
          }}
          className={`text-[#D97706] hover:underline ${isEmbeddableUrl(url) ? 'bg-amber-500/10 px-1 rounded' : ''}`}
        >
          {url}
        </button>
      )
      lastIndex = urlIndex + url.length
    })
    if (lastIndex < content.length) {
      parts.push(<span key="text-end">{content.slice(lastIndex)}</span>)
    }

    return <p className="whitespace-pre-line text-sm leading-relaxed">{parts}</p>
  }

  return (
    <div className="flex flex-col gap-2 max-w-full">
      <div className="relative group">
        <div
          ref={drag}
          onClick={onSelect}
          className={`cursor-pointer transition-opacity ${
            isSelected ? 'bg-zinc-800/50 -mx-2 px-2 py-1 rounded' : ''
          } ${isDragging ? 'opacity-50' : ''}`}
        >
          {renderContent()}
        </div>
      </div>
      {/* Share button */}
      {isSelected && index > 0 && (
        <button
          onClick={onShare}
          disabled={sharing}
          className="self-start flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
        >
          {sharing ? (
            'Sharing...'
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share to chat
            </>
          )}
        </button>
      )}
    </div>
  )
}

export default function BrainThread() {
  const { user } = useAuthStore()
  const {
    brainMessages, brainLoading, brainDocumentContext, groupId,
    embeddedUrl, setEmbeddedUrl, brainInputPrefill, setBrainInputPrefill,
    brainTabs, activeBrainTabId, addBrainTab, closeBrainTab, setActiveBrainTab
  } = useChatStore()
  const { sendBrainMessage, shareToTeamChat, refreshDocuments } = useChatContext()

  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState<number | null>(null)
  const [sharing, setSharing] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [brainMessages])

  // Handle prefill from expanded message modal
  useEffect(() => {
    if (brainInputPrefill) {
      setInput(brainInputPrefill)
      setBrainInputPrefill(null)
      inputRef.current?.focus()
    }
  }, [brainInputPrefill, setBrainInputPrefill])

  // Drop zone for messages and files
  const [{ isOver, canDrop }, drop] = useDrop<MessageDragItem | FileDragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: [DragTypes.MESSAGE_TEXT, DragTypes.MEDIA_FILE],
    drop: (item) => {
      if (item.type === DragTypes.MESSAGE_TEXT) {
        const msgItem = item as MessageDragItem
        const prefix = msgItem.authorName ? `About ${msgItem.authorName}'s message:\n` : ''
        setInput(`${prefix}"${msgItem.content.slice(0, 300)}${msgItem.content.length > 300 ? '...' : ''}"\n\nTell me more about this.`)
        inputRef.current?.focus()
      } else if (item.type === DragTypes.MEDIA_FILE) {
        const fileItem = item as FileDragItem
        addBrainTab(fileItem.filename, fileItem.fileId, fileItem.filename)
        setInput(`Tell me about this file.`)
        inputRef.current?.focus()
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [addBrainTab])

  const handleSend = async () => {
    if (!input.trim() || brainLoading) return

    const messageContent = input
    setInput('')

    await sendBrainMessage(messageContent, attachedFiles.length > 0 ? attachedFiles : undefined)
    setAttachedFiles([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleShare = async (messageIndex: number) => {
    const message = brainMessages[messageIndex]
    if (!message || message.role !== 'brain') return

    setSharing(true)
    try {
      await shareToTeamChat(message.content, 'brain')
      setSelectedMessage(null)
    } catch (err) {
      console.error('Share error:', err)
    } finally {
      setSharing(false)
    }
  }

  const handleFileUpload = async (fileList: FileList) => {
    if (fileList.length === 0 || !groupId) return

    setUploading(true)
    const uploadedFiles: AttachedFile[] = []

    for (const file of Array.from(fileList)) {
      try {
        const { document } = await filesApi.upload(file)
        await filesApi.shareToGroup(document.id, groupId, false)
        uploadedFiles.push({ id: document.id, name: document.filename })
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err)
      }
    }

    if (uploadedFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...uploadedFiles])
      refreshDocuments()
    }

    setUploading(false)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files)
      e.target.value = ''
    }
  }

  const removeAttachedFile = (fileId: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const handleLinkClick = (url: string) => {
    const embeddable = ['youtube.com', 'youtu.be', 'vimeo.com']
    if (embeddable.some(domain => url.includes(domain))) {
      setEmbeddedUrl(url)
    } else {
      window.open(url, '_blank')
    }
  }

  // If web embed is active, show it
  if (embeddedUrl) {
    return <WebEmbed url={embeddedUrl} onClose={() => setEmbeddedUrl(null)} />
  }

  const firstName = user?.name?.split(' ')[0] || 'there'
  const hasMessages = brainMessages.length > 1 || (brainMessages.length === 1 && brainMessages[0].role === 'user')

  return (
    <div
      ref={drop}
      className={`h-full flex flex-col bg-black transition-colors ${
        isOver && canDrop ? 'ring-2 ring-inset ring-[#D97706]' : ''
      }`}
    >
      {/* Tab bar - always visible, same style as ContentTabBar */}
      <div className="flex items-center bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
        {brainTabs.map(tab => (
          <div
            key={tab.id}
            className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-r border-zinc-800 min-w-0 ${
              activeBrainTabId === tab.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
            }`}
            onClick={() => setActiveBrainTab(tab.id)}
          >
            <span className="text-xs">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </span>
            <span className="truncate max-w-[120px]">{tab.name}</span>
            {brainTabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeBrainTab(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white ml-1 transition-opacity"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => addBrainTab('New Chat')}
          className="px-3 py-2 text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-colors"
          title="New conversation"
        >
          +
        </button>
      </div>

      {/* Context indicator */}
      {brainDocumentContext && (
        <div className="px-4 py-2 text-xs text-zinc-400 bg-zinc-900/50 border-b border-zinc-800 flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {brainDocumentContext.name}
        </div>
      )}

      {/* Drop zone indicator */}
      {(isOver && canDrop) && (
        <div className="px-4 py-3 bg-[#D97706]/10 text-[#D97706] text-sm text-center border-b border-[#D97706]/30">
          Drop to ask about this
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-auto">
        {!hasMessages ? (
          /* Empty state - Claude-like greeting */
          <div className="h-full flex flex-col items-center justify-center px-8">
            <div className="max-w-md text-center">
              <h1 className="text-2xl font-light text-white mb-2">
                Hey {firstName}
              </h1>
              <p className="text-zinc-400 text-sm mb-8">
                Ask me anything about your workspace documents, conversations, or just chat.
              </p>

              {/* Suggestion chips */}
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setInput('Summarize recent conversations')}
                  className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 transition-colors"
                >
                  Summarize recent conversations
                </button>
                <button
                  onClick={() => setInput('What files were shared this week?')}
                  className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 transition-colors"
                >
                  What files were shared this week?
                </button>
                <button
                  onClick={() => setInput('Help me draft a message')}
                  className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 transition-colors"
                >
                  Help me draft a message
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="p-4 space-y-6">
            {brainMessages.map((msg, i) => (
              <div key={msg.id || i}>
                {msg.role === 'user' ? (
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium shrink-0">
                      {user?.name?.charAt(0) || '?'}
                    </div>
                    <div className="pt-1">
                      <p className="text-sm font-medium text-white mb-1">{user?.name || 'You'}</p>
                      <p className="text-sm text-zinc-300 whitespace-pre-line">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#D97706] to-[#F59E0B] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                    </div>
                    <div className="pt-1 flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#D97706] mb-1">Brain</p>
                      <DraggableBrainMessage
                        content={msg.content}
                        index={i}
                        documentContext={brainDocumentContext}
                        isSelected={selectedMessage === i}
                        onSelect={() => i > 0 && setSelectedMessage(selectedMessage === i ? null : i)}
                        onShare={() => handleShare(i)}
                        sharing={sharing}
                        onLinkClick={handleLinkClick}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {brainLoading && brainMessages[brainMessages.length - 1]?.content === '' && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#D97706] to-[#F59E0B] flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                </div>
                <div className="pt-1">
                  <p className="text-sm font-medium text-[#D97706] mb-1">Brain</p>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-[#D97706] rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-[#D97706] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-1.5 h-1.5 bg-[#D97706] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Streaming cursor */}
            {brainLoading && brainMessages[brainMessages.length - 1]?.content !== '' && (
              <div className="ml-10 text-[#D97706] animate-pulse">
                |
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-zinc-800 bg-black">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Attached files */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachedFiles.map(file => (
              <div
                key={file.id}
                className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs"
              >
                <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate max-w-32">{file.name}</span>
                <button
                  onClick={() => removeAttachedFile(file.id)}
                  className="text-zinc-500 hover:text-white"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Uploading indicator */}
        {uploading && (
          <div className="flex items-center gap-2 mb-3 text-xs text-[#D97706]">
            <div className="flex gap-0.5">
              <div className="w-1 h-1 bg-[#D97706] rounded-full animate-bounce" />
              <div className="w-1 h-1 bg-[#D97706] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-1 h-1 bg-[#D97706] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
            Uploading...
          </div>
        )}

        {/* Input box */}
        <div className="relative bg-zinc-900 rounded-xl border border-zinc-700 focus-within:border-zinc-600 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={brainLoading}
            rows={1}
            className="w-full bg-transparent px-4 py-3 pr-24 text-sm resize-none focus:outline-none disabled:opacity-50 max-h-32"
            style={{ minHeight: '44px' }}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="p-2 text-zinc-500 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
              title="Attach file"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <button
              onClick={handleSend}
              disabled={brainLoading || !input.trim()}
              className="p-2 bg-white text-black rounded-lg disabled:opacity-30 hover:bg-zinc-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
