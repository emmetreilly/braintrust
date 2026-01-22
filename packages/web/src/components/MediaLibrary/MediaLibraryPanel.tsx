import { useState, useMemo, useCallback } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { NativeTypes } from 'react-dnd-html5-backend'
import { useChatStore } from '../../stores/chat'
import { useChatContext } from '../Chat/ChatContext'
import { DragTypes, FileDragItem, MessageDragItem, BrainDragItem } from '../ui/DragDropContext'
import { formatDistanceToNow } from 'date-fns'
import { files as filesApi } from '../../lib/api'
import type { Document } from '../../types'

interface DraggableFileCardProps {
  file: Document
  isSelected: boolean
  onClick: () => void
}

function DraggableFileCard({ file, isSelected, onClick }: DraggableFileCardProps) {
  const [{ isDragging }, drag] = useDrag<FileDragItem, void, { isDragging: boolean }>(() => ({
    type: DragTypes.MEDIA_FILE,
    item: {
      type: DragTypes.MEDIA_FILE,
      fileId: file.id,
      filename: file.filename,
      fileType: file.file_type,
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [file])

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

  return (
    <button
      ref={drag}
      onClick={onClick}
      className={`w-full px-3 py-2 hover:bg-zinc-900 transition-colors text-left group ${
        isSelected ? 'bg-zinc-900 border-l-2 border-cyan-500' : ''
      } ${isDragging ? 'opacity-50' : ''}`}
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
        {isSelected && (
          <div className="w-5 h-5 rounded-full bg-cyan-500/30 flex items-center justify-center text-[10px]">
            🧠
          </div>
        )}
        {/* Drag indicator */}
        <div className="w-4 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
          ⋮⋮
        </div>
      </div>
    </button>
  )
}

export default function MediaLibraryPanel() {
  const { documents, allTags, selectedDocument, groupId, setDocuments } = useChatStore()
  const { openDocumentInBrain } = useChatContext()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchMode, setSearchMode] = useState<'filter' | 'semantic'>('filter')

  // Handle semantic search (natural language)
  const handleSemanticSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    setSearchMode('semantic')
    try {
      const results = await filesApi.search(searchQuery)
      setDocuments(results.documents)
    } catch (err) {
      console.error('Semantic search failed:', err)
      // Fall back to filter mode
      setSearchMode('filter')
    } finally {
      setIsSearching(false)
    }
  }

  // Reset to all documents
  const handleClearSearch = async () => {
    setSearchQuery('')
    setSearchMode('filter')
    if (groupId) {
      const filesRes = await filesApi.listByGroup(groupId)
      setDocuments(filesRes.documents)
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSemanticSearch()
    }
    if (e.key === 'Escape') {
      handleClearSearch()
    }
  }

  // Handle text/brain content drop
  const handleContentDrop = useCallback(async (item: MessageDragItem | BrainDragItem) => {
    if (!groupId) return
    setSaving(true)
    try {
      const title = item.type === DragTypes.MESSAGE_TEXT
        ? `Note from ${(item as MessageDragItem).authorName || 'chat'}`
        : item.type === DragTypes.BRAIN_RESPONSE && (item as BrainDragItem).documentContext
          ? `Brain insight: ${(item as BrainDragItem).documentContext?.name}`
          : 'Brain response'

      await filesApi.createFromText(title, item.content, groupId)
      // Refresh the document list
      const filesRes = await filesApi.listByGroup(groupId)
      useChatStore.getState().setDocuments(filesRes.documents)
    } catch (err) {
      console.error('Failed to save content:', err)
    } finally {
      setSaving(false)
    }
  }, [groupId])

  // Handle native file drop from Finder/Downloads
  const handleFileDrop = useCallback(async (files: File[]) => {
    if (!groupId || files.length === 0) return
    setSaving(true)
    try {
      for (const file of files) {
        // Upload the file
        const { document } = await filesApi.upload(file)
        // Share to the group
        await filesApi.shareToGroup(document.id, groupId, false)
      }
      // Refresh the document list
      const filesRes = await filesApi.listByGroup(groupId)
      useChatStore.getState().setDocuments(filesRes.documents)
    } catch (err) {
      console.error('Failed to upload files:', err)
    } finally {
      setSaving(false)
    }
  }, [groupId])

  // Drop zone for saving content AND native files
  const [{ isOver, canDrop }, drop] = useDrop<MessageDragItem | BrainDragItem | { files: File[] }, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: [DragTypes.MESSAGE_TEXT, DragTypes.BRAIN_RESPONSE, NativeTypes.FILE],
    drop: (item, monitor) => {
      const itemType = monitor.getItemType()
      console.log('Drop received:', itemType, item)
      if (itemType === NativeTypes.FILE) {
        const nativeItem = item as { files: File[] }
        console.log('Native file drop:', nativeItem.files)
        if (nativeItem.files && nativeItem.files.length > 0) {
          handleFileDrop(nativeItem.files)
        }
      } else {
        handleContentDrop(item as MessageDragItem | BrainDragItem)
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [groupId, handleFileDrop, handleContentDrop])

  // Filter documents by search query AND selected tags
  // In semantic mode, documents are already filtered by the server
  const filteredFiles = useMemo(() => {
    if (searchMode === 'semantic') {
      // Server already did semantic search, just apply tag filters
      if (selectedTags.length > 0) {
        return documents.filter(file => {
          const fileTags = file.tags?.map(t => t.id) || []
          return selectedTags.some(tagId => fileTags.includes(tagId))
        })
      }
      return documents
    }

    // Local filter mode
    return documents.filter(file => {
      const matchesSearch = file.filename.toLowerCase().includes(searchQuery.toLowerCase())
      if (!matchesSearch) return false

      if (selectedTags.length > 0) {
        const fileTags = file.tags?.map(t => t.id) || []
        return selectedTags.some(tagId => fileTags.includes(tagId))
      }

      return true
    })
  }, [documents, searchQuery, selectedTags, searchMode])

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

  const handleDocumentClick = (doc: Document) => {
    openDocumentInBrain(doc)
  }

  return (
    <div
      ref={drop}
      className={`h-full flex flex-col bg-zinc-950 border-l border-zinc-800 transition-colors ${
        isOver && canDrop ? 'bg-cyan-950/30 ring-2 ring-inset ring-cyan-500' : ''
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-zinc-400">Media Library</h3>
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

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (!e.target.value) setSearchMode('filter')
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={isSearching ? "Searching..." : "Search files... (Enter for AI search)"}
            className="w-full bg-zinc-900 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 pr-8"
            disabled={isSearching}
          />
          {searchMode === 'semantic' && searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              title="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Semantic search indicator */}
        {searchMode === 'semantic' && !isSearching && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-cyan-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>AI search results</span>
          </div>
        )}

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

      {/* Drop zone indicator */}
      {(isOver && canDrop) && (
        <div className="px-3 py-2 bg-cyan-500/20 text-cyan-400 text-xs text-center border-b border-cyan-500/30">
          Drop to upload
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="px-3 py-2 bg-zinc-800 text-zinc-400 text-xs text-center border-b border-zinc-700">
          Uploading...
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {documents.length === 0 ? (
          <div className="p-4 text-center text-zinc-600">
            <p className="text-xs">No files yet</p>
            <p className="text-[10px] mt-1 text-zinc-700">Drop files from Finder here</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-4 text-center text-zinc-600">
            <p className="text-xs">No files match your search</p>
          </div>
        ) : (
          <div className="py-1">
            {filteredFiles.map(file => (
              <DraggableFileCard
                key={file.id}
                file={file}
                isSelected={selectedDocument?.id === file.id}
                onClick={() => handleDocumentClick(file)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-600 text-center">
        Drop files here · Drag to Brain
      </div>
    </div>
  )
}
