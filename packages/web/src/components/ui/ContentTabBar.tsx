import { useState } from 'react'
import { useChatStore, ContentTab } from '../../stores/chat'

const tabIcons: Record<ContentTab['type'], string> = {
  chat: '💬',
  doc: '📄',
  web: '🌐',
  video: '▶️',
}

export default function ContentTabBar() {
  const { contentTabs, activeContentTabId, setActiveContentTab, closeContentTab, addContentTab, reorderContentTabs } = useChatStore()
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleOpenWeb = (url?: string) => {
    const targetUrl = url || 'https://www.google.com'
    addContentTab({
      type: 'web',
      title: 'Web',
      url: targetUrl,
    })
    setShowUrlInput(false)
    setUrlInput('')
  }

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (urlInput.trim()) {
      let url = urlInput.trim()
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url
      }
      handleOpenWeb(url)
    }
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      reorderContentTabs(draggedIndex, toIndex)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className="flex items-center bg-zinc-900 border-b border-zinc-800">
      <div className="flex items-center overflow-x-auto flex-1">
        {contentTabs.map((tab, index) => (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-r border-zinc-800 min-w-0 transition-all ${
              activeContentTabId === tab.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
            } ${draggedIndex === index ? 'opacity-50' : ''} ${
              dragOverIndex === index && draggedIndex !== index
                ? 'border-l-2 border-l-cyan-500'
                : ''
            }`}
            onClick={() => setActiveContentTab(tab.id)}
          >
            <span className="text-xs">{tabIcons[tab.type]}</span>
            <span className="truncate max-w-[120px]">{tab.title}</span>
            {tab.id !== 'chat' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeContentTab(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white ml-1 transition-opacity"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Open Web Button */}
      <div className="flex items-center px-2 border-l border-zinc-800 gap-1">
        {showUrlInput ? (
          <form onSubmit={handleUrlSubmit} className="flex items-center gap-1">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter URL..."
              className="w-40 bg-zinc-800 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
              autoFocus
              onBlur={() => {
                if (!urlInput.trim()) setShowUrlInput(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowUrlInput(false)
                  setUrlInput('')
                }
              }}
            />
            <button
              type="submit"
              className="p-1 text-cyan-400 hover:text-cyan-300"
              title="Go"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>
        ) : (
          <>
            {/* Main button opens Google directly */}
            <button
              onClick={() => handleOpenWeb()}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
              title="Open Google"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              <span>Web</span>
            </button>
            {/* Small button for custom URL */}
            <button
              onClick={() => setShowUrlInput(true)}
              className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"
              title="Enter custom URL"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
