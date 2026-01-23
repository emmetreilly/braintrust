import { useState, useCallback } from 'react'
import { useChatStore } from '../../stores/chat'
import ContentTabBar from './ContentTabBar'
import TeamChatPanel from '../Chat/TeamChatPanel'
import ElectronWebView from './ElectronWebView'

interface TabbedContentPanelProps {
  onShowShareModal: () => void
}

export default function TabbedContentPanel({ onShowShareModal }: TabbedContentPanelProps) {
  const { contentTabs, activeContentTabId, addContentTab } = useChatStore()
  const activeTab = contentTabs.find(t => t.id === activeContentTabId)
  const [isDragOver, setIsDragOver] = useState(false)

  // Open links in a new tab instead of externally or in Brain panel
  const handleOpenLink = useCallback((url: string) => {
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
    let title = 'Web'
    try {
      title = isYouTube ? 'YouTube' : new URL(url).hostname
    } catch {
      // Invalid URL, use default title
    }

    addContentTab({
      type: isYouTube ? 'video' : 'web',
      title,
      url,
    })
  }, [addContentTab])

  // Handle URL drops from browser
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Check if it's a URL being dragged
    if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
      setIsDragOver(true)
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // Try to get URL from drop
    let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''

    // Clean up the URL (sometimes has extra text)
    url = url.trim().split('\n')[0]

    // Validate it's a URL
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      handleOpenLink(url)
    }
  }, [handleOpenLink])

  const renderContent = () => {
    if (!activeTab) return null

    switch (activeTab.type) {
      case 'chat':
        return (
          <TeamChatPanel
            onShowShareModal={onShowShareModal}
            onOpenLinkInBrain={handleOpenLink}
          />
        )

      case 'doc':
        return (
          <div className="h-full flex flex-col">
            {activeTab.documentUrl ? (
              <iframe
                src={activeTab.documentUrl}
                className="flex-1 w-full bg-white"
                title={activeTab.title}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-500">
                <div className="text-center">
                  <div className="text-4xl mb-2">📄</div>
                  <div>{activeTab.title}</div>
                  <div className="text-sm mt-1">Document preview not available</div>
                </div>
              </div>
            )}
          </div>
        )

      case 'web':
        return activeTab.url ? (
          <ElectronWebView
            tabId={activeTab.id}
            url={activeTab.url}
            title={activeTab.title}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-500">
            No URL provided
          </div>
        )

      case 'video':
        return (
          <div className="h-full flex flex-col bg-black">
            {activeTab.url ? (
              <div className="flex-1 flex items-center justify-center">
                {activeTab.url.includes('youtube.com') || activeTab.url.includes('youtu.be') ? (
                  <iframe
                    src={getYouTubeEmbedUrl(activeTab.url)}
                    className="w-full h-full max-w-4xl max-h-[80%] aspect-video"
                    title={activeTab.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video
                    src={activeTab.url}
                    controls
                    className="max-w-full max-h-full"
                  />
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-500">
                No video URL provided
              </div>
            )}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      className={`h-full flex flex-col relative ${isDragOver ? 'ring-2 ring-inset ring-cyan-500' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ContentTabBar />
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>

      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-cyan-500/10 flex items-center justify-center pointer-events-none z-50">
          <div className="bg-zinc-900/90 rounded-xl p-6 text-center">
            <div className="text-4xl mb-2">🌐</div>
            <div className="text-white font-medium">Drop URL to open</div>
            <div className="text-zinc-400 text-sm">Opens in a new tab</div>
          </div>
        </div>
      )}
    </div>
  )
}

function getYouTubeEmbedUrl(url: string): string {
  const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1]
  return videoId ? `https://www.youtube.com/embed/${videoId}` : url
}
