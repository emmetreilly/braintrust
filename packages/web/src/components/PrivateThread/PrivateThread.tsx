import { useState, useEffect, useRef } from 'react'
import { brain, messages as messagesApi, files as filesApi } from '../../lib/api'

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

interface AttachedFile {
  id: string
  name: string
}

export default function PrivateThread({ groupId, context, documentId, documentName, onClose, onShareInsight }: PrivateThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingThread, setIsLoadingThread] = useState(true)
  const [selectedMessage, setSelectedMessage] = useState<number | null>(null)
  const [sharing, setSharing] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load existing thread on mount, and extract document content if needed
  useEffect(() => {
    const loadThread = async () => {
      try {
        // If we have a documentId, try to extract content first (in case it wasn't extracted on upload)
        if (documentId) {
          setMessages([{
            role: 'brain',
            content: `Loading "${documentName || 'document'}"...`,
          }])

          try {
            const extractResult = await filesApi.extract(documentId)
            console.log('Document extraction result:', extractResult)

            if (extractResult.success || extractResult.content_text) {
              // Content extracted or already exists
              setMessages([{
                role: 'brain',
                content: `I've loaded "${documentName}". What would you like to know about it? You can ask me to summarize, find key points, or answer specific questions.`,
              }])
            } else if (extractResult.message?.includes('already has')) {
              // Already extracted
              setMessages([{
                role: 'brain',
                content: `I've loaded "${documentName}". What would you like to know about it? You can ask me to summarize, find key points, or answer specific questions.`,
              }])
            } else {
              // Extraction failed - show error
              setMessages([{
                role: 'brain',
                content: extractResult.message || `I couldn't read the content of "${documentName}". You may need to re-upload it or check that an API key is configured in Settings.`,
              }])
            }
          } catch (extractErr) {
            console.error('Document extraction error:', extractErr)
            // Continue anyway - maybe content was already extracted
            setMessages([{
              role: 'brain',
              content: `I've loaded "${documentName}". What would you like to know about it?`,
            }])
          }
        }

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
          // New thread - show welcome (already set above if documentId exists)
          if (!documentId) {
            setMessages([{
              role: 'brain',
              content: "Private thread — only you can see this. I can go deeper on anything, fact-check, help draft a reply, or find related stuff.",
            }])
          }
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
    const messageContent = input
    setInput('')
    setIsLoading(true)

    try {
      // Build context from attached files
      let fileContext = context || undefined
      if (attachedFiles.length > 0) {
        const fileNames = attachedFiles.map(f => f.name).join(', ')
        fileContext = `[User has uploaded files for context: ${fileNames}. Include their content when answering.] ${fileContext || ''}`
      }

      // Use the first attached file as the document context if no document is already set
      const effectiveDocId = documentId || (attachedFiles.length > 0 ? attachedFiles[0].id : undefined)
      const effectiveDocName = documentName || (attachedFiles.length > 0 ? attachedFiles[0].name : undefined)

      console.log('PrivateThread sending - documentId:', documentId, 'effectiveDocId:', effectiveDocId, 'effectiveDocName:', effectiveDocName)

      // Use persistent thread API
      const { userMessage: savedUserMsg, brainMessage } = await brain.sendPrivateMessage(
        groupId,
        messageContent,
        effectiveDocId,
        effectiveDocName,
        fileContext
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
      // Create an insight message in the group chat - just the content
      const insightContent = message.content

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

  const handleFileUpload = async (fileList: FileList) => {
    if (fileList.length === 0) return

    setUploading(true)
    const uploadedFiles: AttachedFile[] = []

    for (const file of Array.from(fileList)) {
      try {
        // Upload the file
        const { document } = await filesApi.upload(file)

        // Share to the group (triggers text extraction)
        await filesApi.shareToGroup(document.id, groupId, false)

        uploadedFiles.push({ id: document.id, name: document.filename })
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err)
      }
    }

    if (uploadedFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...uploadedFiles])

      // Add a system message showing what was uploaded
      const fileNames = uploadedFiles.map(f => f.name).join(', ')
      setMessages(prev => [...prev, {
        role: 'brain',
        content: `I've loaded ${uploadedFiles.length > 1 ? 'these files' : 'this file'}: ${fileNames}. You can ask me questions about ${uploadedFiles.length > 1 ? 'them' : 'it'} now.`,
      }])
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

  return (
    <div className="bg-zinc-950 h-full text-white flex flex-col">
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
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Attached files preview */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachedFiles.map(file => (
              <div
                key={file.id}
                className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5 text-sm"
              >
                <span className="text-zinc-400">📄</span>
                <span className="truncate max-w-32">{file.name}</span>
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
          <div className="flex items-center gap-2 mb-3 text-sm text-cyan-400">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
            Uploading files...
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-12 h-12 bg-zinc-800 text-zinc-400 hover:text-white rounded-full flex items-center justify-center text-xl disabled:opacity-50 hover:bg-zinc-700 transition-colors"
            title="Attach files for context"
          >
            +
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={documentName ? `Ask about ${documentName}...` : attachedFiles.length > 0 ? 'Ask about these files...' : 'Ask Brain privately...'}
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

        {/* Hint about file uploads */}
        {!documentName && attachedFiles.length === 0 && (
          <p className="text-xs text-zinc-600 text-center mt-2">
            Click + to add files for focused context
          </p>
        )}
      </div>
    </div>
  )
}
