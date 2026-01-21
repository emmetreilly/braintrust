import { useState, useEffect } from 'react'
import { files as filesApi } from '../../lib/api'
import type { Document } from '../../types'
import { formatDistanceToNow } from 'date-fns'

interface DocumentPanelProps {
  groupId: string
  onDocumentSelect: (doc: Document) => void
  onClose: () => void
}

export default function DocumentPanel({ groupId, onDocumentSelect, onClose }: DocumentPanelProps) {
  const [files, setFiles] = useState<Document[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadData()
  }, [groupId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const filesRes = await filesApi.listByGroup(groupId)
      setFiles(filesRes.documents)
    } catch (err) {
      console.error('Failed to load documents:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredFiles = files.filter(file =>
    file.filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Delete this file?')) return
    try {
      await filesApi.delete(fileId)
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      console.error('Failed to delete file:', err)
    }
  }

  const handleReferenceToggle = async (fileId: string, isReference: boolean) => {
    try {
      await filesApi.setReference(fileId, groupId, isReference)
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, is_reference: isReference } : f
      ))
    } catch (err) {
      console.error('Failed to toggle reference:', err)
    }
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
          <h2 className="font-semibold">Files</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 text-center text-zinc-500">Loading...</div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-4 text-center text-zinc-500">
            <div className="text-3xl mb-2">📁</div>
            <p>{searchQuery ? 'No files match your search' : 'No files yet'}</p>
            <p className="text-xs mt-1">Upload files in the chat to add them here</p>
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
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm truncate">{file.filename}</h3>
                      {file.is_reference && (
                        <span className="text-xs" title="Reference doc">📌</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {formatFileSize(file.file_size)} · {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleReferenceToggle(file.id, !file.is_reference)
                      }}
                      className={`w-7 h-7 rounded flex items-center justify-center text-xs ${
                        file.is_reference
                          ? 'bg-amber-600/20 text-amber-400'
                          : 'hover:bg-zinc-700 text-zinc-400'
                      }`}
                      title={file.is_reference ? 'Remove as reference' : 'Pin as reference'}
                    >
                      📌
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteFile(file.id)
                      }}
                      className="w-7 h-7 rounded hover:bg-red-900/50 flex items-center justify-center text-zinc-400 hover:text-red-400 text-xs"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-zinc-800 text-xs text-zinc-500 text-center">
        Click a file to ask Brain about it
      </div>
    </div>
  )
}
