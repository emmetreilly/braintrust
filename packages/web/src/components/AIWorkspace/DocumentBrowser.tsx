import { useState, useMemo } from 'react'
import { useChatStore } from '../../stores/chat'
import { useChatContext } from '../Chat/ChatContext'
import { formatDistanceToNow } from 'date-fns'
import type { Document } from '../../types'

export default function DocumentBrowser() {
  const { documents, allTags, selectedDocument } = useChatStore()
  const { openDocumentInBrain } = useChatContext()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showTagFilter, setShowTagFilter] = useState(false)

  // Filter documents by search query AND selected tags
  const filteredFiles = useMemo(() => {
    return documents.filter(file => {
      // Search filter
      const matchesSearch = file.filename.toLowerCase().includes(searchQuery.toLowerCase())
      if (!matchesSearch) return false

      // Tag filter (if tags selected, file must have at least one matching tag)
      if (selectedTags.length > 0) {
        const fileTags = file.tags?.map(t => t.id) || []
        return selectedTags.some(tagId => fileTags.includes(tagId))
      }

      return true
    })
  }, [documents, searchQuery, selectedTags])

  // Get unique tags that appear on current files
  const availableTags = useMemo(() => {
    return allTags.filter(tag =>
      documents.some(file => file.tags?.some(t => t.id === tag.id))
    )
  }, [allTags, documents])

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return '📄'
    if (type.includes('word') || type.includes('doc')) return '📝'
    if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return '📊'
    if (type.includes('presentation') || type.includes('powerpoint')) return '📽️'
    if (type.includes('image')) return '🖼️'
    return '📁'
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleDocumentClick = (doc: Document) => {
    openDocumentInBrain(doc)
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-zinc-400">Channel Files</h3>
          <div className="flex items-center gap-1">
            <span className="text-xs text-zinc-600">{documents.length}</span>
            {availableTags.length > 0 && (
              <button
                onClick={() => setShowTagFilter(!showTagFilter)}
                className={`text-zinc-400 hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 ${
                  selectedTags.length > 0 ? 'text-cyan-400' : ''
                }`}
                title="Filter by tags"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className="w-full bg-zinc-900 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />

        {/* Tag filters */}
        {showTagFilter && availableTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {availableTags.map(tag => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                  selectedTags.includes(tag.id)
                    ? 'ring-1 ring-white/50'
                    : 'opacity-70 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: `${tag.color}30`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </button>
            ))}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="px-2 py-0.5 text-[10px] rounded-full bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Active filter indicator */}
        {selectedTags.length > 0 && !showTagFilter && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-cyan-400">
            <span>Filtering by {selectedTags.length} tag{selectedTags.length > 1 ? 's' : ''}</span>
            <button onClick={() => setSelectedTags([])} className="hover:text-white">✕</button>
          </div>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {documents.length === 0 ? (
          <div className="p-4 text-center text-zinc-600">
            <div className="text-2xl mb-2">📁</div>
            <p className="text-xs">No files shared yet</p>
            <p className="text-[10px] mt-1 text-zinc-700">Drop files in chat to share</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-4 text-center text-zinc-600">
            <p className="text-xs">No files match your search</p>
          </div>
        ) : (
          <div className="py-1">
            {filteredFiles.map(file => (
              <button
                key={file.id}
                onClick={() => handleDocumentClick(file)}
                className={`w-full px-3 py-2 hover:bg-zinc-900 transition-colors text-left group ${
                  selectedDocument?.id === file.id ? 'bg-zinc-900 border-l-2 border-cyan-500' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded bg-zinc-800 flex items-center justify-center shrink-0 text-sm">
                    {getFileIcon(file.file_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-xs truncate">{file.filename}</h4>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {formatFileSize(file.file_size)} · {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
                    </p>
                    {/* Tags */}
                    {file.tags && file.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {file.tags.slice(0, 2).map(tag => (
                          <span
                            key={tag.id}
                            className="px-1 py-0.5 text-[9px] rounded"
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {file.tags.length > 2 && (
                          <span className="px-1 py-0.5 text-[9px] rounded bg-zinc-800 text-zinc-500">
                            +{file.tags.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Brain indicator for selected */}
                  {selectedDocument?.id === file.id && (
                    <div className="w-5 h-5 rounded-full bg-cyan-500/30 flex items-center justify-center text-[10px]">
                      🧠
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-600 text-center">
        Click a file to ask Brain about it
      </div>
    </div>
  )
}
