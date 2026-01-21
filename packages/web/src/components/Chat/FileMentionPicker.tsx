import { useState, useEffect, useRef } from 'react'
import { files as filesApi } from '../../lib/api'
import type { Document } from '../../types'

interface FileMentionPickerProps {
  groupId: string
  query: string
  onSelect: (doc: Document) => void
  onClose: () => void
}

export default function FileMentionPicker({
  groupId,
  query,
  onSelect,
  onClose,
}: FileMentionPickerProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load documents on mount
  useEffect(() => {
    const loadDocs = async () => {
      try {
        const { documents: docs } = await filesApi.listByGroup(groupId)
        setDocuments(docs)
      } catch (err) {
        console.error('Failed to load documents:', err)
      } finally {
        setLoading(false)
      }
    }
    loadDocs()
  }, [groupId])

  // Filter documents based on query
  const filteredDocs = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(query.toLowerCase())
  )

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filteredDocs.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && filteredDocs[selectedIndex]) {
        e.preventDefault()
        onSelect(filteredDocs[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredDocs, selectedIndex, onSelect, onClose])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'pdf':
        return '📄'
      case 'doc':
      case 'docx':
        return '📝'
      case 'xls':
      case 'xlsx':
        return '📊'
      case 'ppt':
      case 'pptx':
        return '📽️'
      case 'txt':
      case 'md':
        return '📃'
      default:
        return '📎'
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden w-72"
      style={{
        bottom: '100%',
        left: 16,
        marginBottom: 8,
      }}
    >
      <div className="px-3 py-2 border-b border-zinc-700 text-xs text-zinc-400">
        Files in this channel
      </div>

      {loading ? (
        <div className="px-3 py-4 text-center text-zinc-500 text-sm">
          Loading...
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="px-3 py-4 text-center text-zinc-500 text-sm">
          {query ? `No files matching "${query}"` : 'No files in this channel'}
        </div>
      ) : (
        <div className="max-h-48 overflow-auto">
          {filteredDocs.map((doc, index) => (
            <button
              key={doc.id}
              onClick={() => onSelect(doc)}
              className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-cyan-600/20 text-white'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <span className="text-base">{getFileIcon(doc.filename)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{doc.filename}</div>
                {doc.is_reference && (
                  <span className="text-xs text-cyan-400">Reference doc</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-500 flex items-center gap-2">
        <span className="bg-zinc-700 px-1.5 py-0.5 rounded">↑↓</span> navigate
        <span className="bg-zinc-700 px-1.5 py-0.5 rounded">↵</span> select
        <span className="bg-zinc-700 px-1.5 py-0.5 rounded">esc</span> close
      </div>
    </div>
  )
}
