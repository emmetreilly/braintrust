import { useState, useEffect } from 'react'
import { files as filesApi } from '../../lib/api'
import type { Document, DocumentTag } from '../../types'
import { formatDistanceToNow } from 'date-fns'

interface DocumentPanelProps {
  groupId: string
  onDocumentSelect: (doc: Document) => void
  onClose: () => void
}

export default function DocumentPanel({ groupId, onDocumentSelect, onClose }: DocumentPanelProps) {
  const [files, setFiles] = useState<Document[]>([])
  const [allTags, setAllTags] = useState<DocumentTag[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showTagFilter, setShowTagFilter] = useState(false)

  useEffect(() => {
    loadData()
  }, [groupId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [filesRes, tagsRes] = await Promise.all([
        filesApi.listByGroup(groupId),
        filesApi.listTags(),
      ])
      setFiles(filesRes.documents)
      setAllTags(tagsRes.tags || [])
    } catch (err) {
      console.error('Failed to load documents:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Filter by search query AND selected tags
  const filteredFiles = files.filter(file => {
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

  // Get unique tags that appear on current files
  const availableTags = allTags.filter(tag =>
    files.some(file => file.tags?.some(t => t.id === tag.id))
  )

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
    return '📁'
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="h-full flex flex-col bg-zinc-900 border-l border-zinc-800">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Shared Files</h2>
          <div className="flex items-center gap-1">
            {availableTags.length > 0 && (
              <button
                onClick={() => setShowTagFilter(!showTagFilter)}
                className={`text-zinc-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 ${
                  selectedTags.length > 0 ? 'text-cyan-400' : ''
                }`}
                title="Filter by tags"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800"
            >
              ✕
            </button>
          </div>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />

        {/* Tag filters */}
        {showTagFilter && availableTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {availableTags.map(tag => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`px-2 py-1 text-xs rounded-full transition-colors ${
                  selectedTags.includes(tag.id)
                    ? 'ring-2 ring-white/50'
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
                className="px-2 py-1 text-xs rounded-full bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Active filter indicator */}
        {selectedTags.length > 0 && !showTagFilter && (
          <div className="mt-2 flex items-center gap-1 text-xs text-cyan-400">
            <span>Filtering by {selectedTags.length} tag{selectedTags.length > 1 ? 's' : ''}</span>
            <button
              onClick={() => setSelectedTags([])}
              className="hover:text-white"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 text-center text-zinc-500">Loading...</div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-4 text-center text-zinc-500">
            <div className="text-3xl mb-2">📁</div>
            <p>{searchQuery ? 'No files match your search' : 'No files shared yet'}</p>
            <p className="text-xs mt-1">Drag files into the chat to share them</p>
          </div>
        ) : (
          <div className="py-2">
            {filteredFiles.map(file => (
              <button
                key={file.id}
                onClick={() => onDocumentSelect(file)}
                className="w-full p-3 hover:bg-zinc-800 transition-colors text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center shrink-0 text-lg">
                    {getFileIcon(file.file_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm truncate">{file.filename}</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {formatFileSize(file.file_size)} · {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
                    </p>
                    {/* Tags */}
                    {file.tags && file.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {file.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag.id}
                            className="px-1.5 py-0.5 text-[10px] rounded"
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {file.tags.length > 3 && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-700 text-zinc-400">
                            +{file.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Quick action: Ask Brain */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <div
                      className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm"
                      title="Ask Brain about this"
                    >
                      🧠
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-zinc-800 text-xs text-zinc-500 text-center">
        Drop files in chat to share · Auto-indexed for Brain
      </div>
    </div>
  )
}
