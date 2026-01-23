import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useChatStore } from '../stores/chat'
import { ChatProvider, useChatContext } from '../components/Chat/ChatContext'
import TabbedContentPanel from '../components/ui/TabbedContentPanel'
import RightPanel from '../components/RightPanel/RightPanel'
import ChannelSidebar from '../components/ChannelSidebar'
import { DragDropProvider } from '../components/ui/DragDropContext'
import { groups as groupsApi, files as filesApi } from '../lib/api'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'

function ChatContent() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { groupId, isLoading } = useChatStore()
  const { sendWsMessage, refreshDocuments } = useChatContext()
  const { addMessage } = useChatStore()

  // Modal states
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [createError, setCreateError] = useState('')
  const [showShareFromClaude, setShowShareFromClaude] = useState(false)
  const [claudeContent, setClaudeContent] = useState('')
  const [claudeTitle, setClaudeTitle] = useState('')
  const [sharingFromClaude, setSharingFromClaude] = useState(false)

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

  const handleShareFromClaude = async () => {
    if (!claudeContent.trim() || !groupId || !user) return

    setSharingFromClaude(true)
    try {
      const title = claudeTitle.trim() || 'Shared content'

      // Create indexed document from content
      const { document } = await filesApi.createFromText(title, claudeContent, groupId)

      // Share to channel
      const shareResult = await filesApi.shareToGroup(document.id, groupId, false)

      // Add to messages
      addMessage(shareResult.message)
      sendWsMessage({ type: 'message', message: shareResult.message })
      refreshDocuments()

      // Reset
      setClaudeContent('')
      setClaudeTitle('')
      setShowShareFromClaude(false)
    } catch (err) {
      console.error('Failed to share content:', err)
    } finally {
      setSharingFromClaude(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    )
  }

  return (
    <DragDropProvider>
      <div className="bg-black h-screen text-white flex overflow-hidden">
        {/* Left: Channel Sidebar - Always visible, VS Code style */}
        <div className="hidden lg:flex h-screen flex-shrink-0">
          <ChannelSidebar onCreateChannel={() => setShowCreateChannel(true)} />
        </div>

        {/* Main content area - Resizable panels */}
        <PanelGroup orientation="horizontal" className="flex-1">
          {/* Main Content (Tabbed: Chat, Doc, Web, Video) */}
          <Panel defaultSize={55} minSize={30}>
            <div className="h-full border-r border-zinc-800">
              <TabbedContentPanel
                onShowShareModal={() => setShowShareFromClaude(true)}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-cyan-500 transition-colors cursor-col-resize" />

          {/* Right Panel (Notes | Brain | Files) */}
          <Panel defaultSize={45} minSize={25}>
            <RightPanel />
          </Panel>
        </PanelGroup>

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
                  Channels are where your team communicates.
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
                  className="flex-1 bg-zinc-800 rounded-lg py-2.5 text-sm hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share from Claude Modal */}
      {showShareFromClaude && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Share Content</h2>
                <p className="text-xs text-zinc-500">Paste a transcript, notes, or any content</p>
              </div>
              <button
                onClick={() => setShowShareFromClaude(false)}
                className="text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-zinc-400 block mb-2">Title (optional)</label>
                <input
                  type="text"
                  value={claudeTitle}
                  onChange={(e) => setClaudeTitle(e.target.value)}
                  placeholder="e.g., Meeting notes"
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="text-sm text-zinc-400 block mb-2">Content</label>
                <textarea
                  value={claudeContent}
                  onChange={(e) => setClaudeContent(e.target.value)}
                  placeholder="Paste your content here..."
                  rows={8}
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowShareFromClaude(false)
                  setClaudeContent('')
                  setClaudeTitle('')
                }}
                className="flex-1 bg-zinc-800 rounded-lg py-2.5 text-sm hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleShareFromClaude}
                disabled={!claudeContent.trim() || sharingFromClaude}
                className="flex-1 bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
              >
                {sharingFromClaude ? 'Sharing...' : 'Share & Index'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </DragDropProvider>
  )
}

export default function Chat() {
  const { groupId } = useParams<{ groupId: string }>()

  if (!groupId) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-zinc-500">No channel selected</div>
      </div>
    )
  }

  return (
    <ChatProvider groupId={groupId}>
      <ChatContent />
    </ChatProvider>
  )
}
