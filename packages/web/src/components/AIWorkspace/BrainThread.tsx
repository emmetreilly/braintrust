import { useState, useRef, useEffect } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { useChatStore, AttachedFile } from '../../stores/chat'
import { useChatContext } from '../Chat/ChatContext'
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
      return <p className="whitespace-pre-line text-xs">{content}</p>
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
          className={`text-cyan-400 hover:underline ${isEmbeddableUrl(url) ? 'bg-cyan-500/10 px-1 rounded' : ''}`}
        >
          {url}
        </button>
      )
      lastIndex = urlIndex + url.length
    })
    if (lastIndex < content.length) {
      parts.push(<span key="text-end">{content.slice(lastIndex)}</span>)
    }

    return <p className="whitespace-pre-line text-xs">{parts}</p>
  }

  return (
    <div className="flex flex-col gap-1 max-w-[85%]">
      <div className="relative group">
        <div
          ref={drag}
          onClick={onSelect}
          className={`rounded-xl px-3 py-2 text-sm bg-zinc-900 rounded-bl-sm cursor-pointer hover:bg-zinc-800/80 transition-opacity ${
            isSelected ? 'ring-1 ring-cyan-500' : ''
          } ${isDragging ? 'opacity-50' : ''}`}
        >
          {renderContent()}
        </div>
        {/* Drag hint */}
        <div className="absolute -right-6 top-1/2 -translate-y-1/2 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </div>
      </div>
      {/* Share button */}
      {isSelected && index > 0 && (
        <button
          onClick={onShare}
          disabled={sharing}
          className="self-start ml-8 flex items-center gap-1 text-[10px] bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded-full hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
        >
          {sharing ? (
            '...'
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share to Chat
            </>
          )}
        </button>
      )}
    </div>
  )
}

export default function BrainThread() {
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
  const inputRef = useRef<HTMLInputElement>(null)

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
        // Create a new tab for this file context
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

  return (
    <div
      ref={drop}
      className={`h-full flex flex-col bg-zinc-950 transition-colors ${
        isOver && canDrop ? 'bg-cyan-950/30 ring-2 ring-inset ring-cyan-500' : ''
      }`}
    >
      {/* Header with tabs */}
      <div className="border-b border-zinc-800">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-2 pt-2 overflow-x-auto">
          {brainTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveBrainTab(tab.id)}
              className={`group flex items-center gap-1 px-3 py-1.5 text-xs rounded-t transition-colors ${
                activeBrainTabId === tab.id
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              <span className="truncate max-w-24">{tab.name}</span>
              {brainTabs.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    closeBrainTab(tab.id)
                  }}
                  className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  x
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => addBrainTab('New Chat')}
            className="px-2 py-1.5 text-xs text-zinc-500 hover:text-white transition-colors"
            title="New conversation"
          >
            +
          </button>
        </div>

        {/* Context indicator */}
        {brainDocumentContext && (
          <div className="px-3 py-1 text-[10px] text-cyan-400 bg-cyan-500/5">
            Context: {brainDocumentContext.name}
          </div>
        )}
      </div>

      {/* Drop zone indicator */}
      {(isOver && canDrop) && (
        <div className="px-3 py-2 bg-cyan-500/20 text-cyan-400 text-xs text-center border-b border-cyan-500/30">
          Drop to ask Brain about this
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {brainMessages.map((msg, i) => (
          <div
            key={msg.id || i}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {msg.role === 'brain' && (
              <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs shrink-0">
                🧠
              </div>
            )}
            {msg.role === 'user' ? (
              <div className="rounded-xl px-3 py-2 text-sm bg-cyan-600 rounded-br-sm max-w-[85%]">
                <p className="whitespace-pre-line text-xs">{msg.content}</p>
              </div>
            ) : (
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
            )}
          </div>
        ))}

        {/* Loading indicator - show only when waiting for first token */}
        {brainLoading && brainMessages[brainMessages.length - 1]?.content === '' && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs">
              🧠
            </div>
            <div className="bg-zinc-900 rounded-xl px-3 py-2 rounded-bl-sm">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
                <span className="text-[10px] text-zinc-500">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming cursor - show typing effect when content is streaming */}
        {brainLoading && brainMessages[brainMessages.length - 1]?.content !== '' && (
          <div className="ml-8 text-cyan-400 text-xs animate-pulse">
            ▋
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-zinc-800">
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
          <div className="flex flex-wrap gap-1 mb-2">
            {attachedFiles.map(file => (
              <div
                key={file.id}
                className="flex items-center gap-1 bg-zinc-800 rounded px-2 py-1 text-[10px]"
              >
                <span>📄</span>
                <span className="truncate max-w-20">{file.name}</span>
                <button
                  onClick={() => removeAttachedFile(file.id)}
                  className="text-zinc-500 hover:text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Uploading indicator */}
        {uploading && (
          <div className="flex items-center gap-2 mb-2 text-[10px] text-cyan-400">
            <div className="flex gap-0.5">
              <div className="w-1 h-1 bg-cyan-400 rounded-full animate-bounce" />
              <div className="w-1 h-1 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-1 h-1 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
            Uploading...
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-9 h-9 bg-zinc-800 text-zinc-400 hover:text-white rounded-full flex items-center justify-center text-lg disabled:opacity-50 hover:bg-zinc-700 transition-colors flex-shrink-0"
            title="Attach files"
          >
            +
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              brainDocumentContext
                ? `Ask about ${brainDocumentContext.name}...`
                : attachedFiles.length > 0
                ? 'Ask about files...'
                : 'Ask Brain anything...'
            }
            disabled={brainLoading}
            className="flex-1 bg-zinc-900 rounded-full px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={brainLoading || !input.trim()}
            className="w-9 h-9 bg-white text-black rounded-full flex items-center justify-center font-bold disabled:opacity-50 hover:bg-zinc-200 transition-colors flex-shrink-0"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
