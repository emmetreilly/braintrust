import { useState, useEffect } from 'react'
import { documents as docsApi, files as filesApi } from '../../lib/api'
import type { ClaudeDocument, Document } from '../../types'
import { formatDistanceToNow } from 'date-fns'

interface DocumentPanelProps {
  groupId: string
  onDocumentSelect: (doc: ClaudeDocument) => void
  onClose: () => void
}

// Sales stage categories
const SALES_STAGES = [
  { id: 'pitch', name: 'Pitch', icon: '🎯', color: '#f97316' },
  { id: 'spec', name: 'Spec', icon: '📋', color: '#3b82f6' },
  { id: 'contract', name: 'Contract', icon: '📝', color: '#22c55e' },
  { id: 'assets', name: 'Assets', icon: '🎨', color: '#a855f7' },
  { id: 'transcripts', name: 'Transcripts', icon: '🎙️', color: '#ec4899' },
  { id: 'summaries', name: 'Meeting Summaries', icon: '📊', color: '#14b8a6' },
  { id: 'other', name: 'Other', icon: '📁', color: '#71717a' },
] as const

type SalesStage = typeof SALES_STAGES[number]['id']

// Helper to categorize files by sales stage based on filename/tags
function categorizeFile(file: Document): SalesStage {
  const name = file.filename.toLowerCase()
  const tags = file.tags?.map(t => t.name.toLowerCase()) || []

  // Check tags first
  if (tags.some(t => t.includes('transcript') || t.includes('tactiq') || t.includes('recording'))) return 'transcripts'
  if (tags.some(t => t.includes('summary') || t.includes('meeting notes') || t.includes('recap'))) return 'summaries'
  if (tags.some(t => t.includes('pitch') || t.includes('deck') || t.includes('proposal'))) return 'pitch'
  if (tags.some(t => t.includes('spec') || t.includes('requirement') || t.includes('prd'))) return 'spec'
  if (tags.some(t => t.includes('contract') || t.includes('agreement') || t.includes('sow'))) return 'contract'
  if (tags.some(t => t.includes('asset') || t.includes('creative') || t.includes('design'))) return 'assets'

  // Check filename - transcripts and summaries first
  if (name.includes('transcript') || name.includes('tactiq') || name.includes('recording') || name.includes('call-') || name.includes('meeting-transcript')) return 'transcripts'
  if (name.includes('summary') || name.includes('meeting-notes') || name.includes('recap') || name.includes('action-items') || name.includes('next-steps')) return 'summaries'

  // Other categories
  if (name.includes('pitch') || name.includes('deck') || name.includes('proposal') || name.includes('intro')) return 'pitch'
  if (name.includes('spec') || name.includes('requirement') || name.includes('prd') || name.includes('scope')) return 'spec'
  if (name.includes('contract') || name.includes('agreement') || name.includes('sow') || name.includes('msa') || name.includes('nda')) return 'contract'
  if (name.includes('asset') || name.includes('creative') || name.includes('logo') || name.includes('brand') || name.includes('design')) return 'assets'

  return 'other'
}

export default function DocumentPanel({ groupId, onDocumentSelect, onClose }: DocumentPanelProps) {
  const [claudeDocs, setClaudeDocs] = useState<ClaudeDocument[]>([])
  const [files, setFiles] = useState<Document[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set(['pitch', 'spec', 'contract', 'assets', 'transcripts', 'summaries']))
  const [filterStage, setFilterStage] = useState<SalesStage | 'all'>('all')
  const [filterUploader, setFilterUploader] = useState<string | 'all'>('all')

  useEffect(() => {
    loadData()
  }, [groupId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [claudeRes, filesRes] = await Promise.all([
        docsApi.list(groupId),
        filesApi.listByGroup(groupId), // Only get documents shared to this channel
      ])
      setClaudeDocs(claudeRes.documents)
      setFiles(filesRes.documents)
    } catch (err) {
      console.error('Failed to load documents:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Get unique uploaders for filter dropdown
  const uploaders = Array.from(new Set(files.map(f => f.uploader?.name).filter(Boolean))) as string[]

  const filteredClaudeDocs = claudeDocs.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.creator_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredFiles = files.filter(file => {
    // Search filter
    const matchesSearch = file.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.uploader?.name?.toLowerCase().includes(searchQuery.toLowerCase())

    // Stage filter
    const matchesStage = filterStage === 'all' || categorizeFile(file) === filterStage

    // Uploader filter
    const matchesUploader = filterUploader === 'all' || file.uploader?.name === filterUploader

    return matchesSearch && matchesStage && matchesUploader
  })

  // Group files by sales stage
  const filesByStage = SALES_STAGES.reduce((acc, stage) => {
    acc[stage.id] = filteredFiles.filter(f => categorizeFile(f) === stage.id)
    return acc
  }, {} as Record<SalesStage, Document[]>)

  const hasActiveFilters = filterStage !== 'all' || filterUploader !== 'all'

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Delete this file?')) return
    try {
      await filesApi.delete(fileId)
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      console.error('Failed to delete file:', err)
    }
  }

  const handleReferenceToggle = (fileId: string, isReference: boolean) => {
    setFiles(prev => prev.map(f =>
      f.id === fileId ? { ...f, is_reference: isReference } : f
    ))
  }

  const toggleStage = (stageId: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageId)) {
        next.delete(stageId)
      } else {
        next.add(stageId)
      }
      return next
    })
  }

  return (
    <div className="h-full flex flex-col bg-zinc-900 border-l border-zinc-800">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Deal Room</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents..."
          className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 mb-2"
        />

        {/* Filters */}
        <div className="flex gap-2">
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value as SalesStage | 'all')}
            className="flex-1 bg-zinc-800 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 text-zinc-300"
          >
            <option value="all">All Categories</option>
            {SALES_STAGES.map(stage => (
              <option key={stage.id} value={stage.id}>{stage.icon} {stage.name}</option>
            ))}
          </select>
          <select
            value={filterUploader}
            onChange={(e) => setFilterUploader(e.target.value)}
            className="flex-1 bg-zinc-800 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 text-zinc-300"
          >
            <option value="all">All People</option>
            {uploaders.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        {/* Active filters indicator */}
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterStage('all'); setFilterUploader('all') }}
            className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
          >
            <span>Clear filters</span>
            <span className="bg-cyan-500/20 px-1.5 py-0.5 rounded">
              {(filterStage !== 'all' ? 1 : 0) + (filterUploader !== 'all' ? 1 : 0)}
            </span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 text-center text-zinc-500">Loading...</div>
        ) : filteredFiles.length === 0 && filteredClaudeDocs.length === 0 ? (
          <div className="p-4 text-center text-zinc-500">
            <div className="text-3xl mb-2">📁</div>
            <p>{searchQuery ? 'No files match your search' : 'No documents yet'}</p>
            <p className="text-xs mt-1">Upload files in the chat to add them here</p>
          </div>
        ) : (
          <div className="py-2">
            {/* Sales Stage Folders */}
            {SALES_STAGES.map(stage => {
              const stageFiles = filesByStage[stage.id]
              if (stageFiles.length === 0) return null

              return (
                <div key={stage.id} className="mb-1">
                  <button
                    onClick={() => toggleStage(stage.id)}
                    className="w-full px-4 py-2 flex items-center gap-2 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <span className="text-zinc-500 text-xs">
                      {expandedStages.has(stage.id) ? '▼' : '▶'}
                    </span>
                    <span className="text-lg">{stage.icon}</span>
                    <span className="font-medium text-sm" style={{ color: stage.color }}>
                      {stage.name}
                    </span>
                    <span className="text-xs text-zinc-500 ml-auto">
                      {stageFiles.length}
                    </span>
                  </button>

                  {expandedStages.has(stage.id) && (
                    <div className="pl-4 border-l-2 ml-6" style={{ borderColor: stage.color + '40' }}>
                      {stageFiles.map(file => (
                        <FileCard
                          key={file.id}
                          file={file}
                          groupId={groupId}
                          onDelete={() => handleDeleteFile(file.id)}
                          onReferenceToggle={(isRef) => handleReferenceToggle(file.id, isRef)}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* AI Documents Section */}
            {filteredClaudeDocs.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <div className="px-4 py-2 flex items-center gap-2">
                  <span className="text-lg">🧠</span>
                  <span className="font-medium text-sm text-cyan-400">AI Documents</span>
                  <span className="text-xs text-zinc-500 ml-auto">{filteredClaudeDocs.length}</span>
                </div>
                <div className="pl-4">
                  {filteredClaudeDocs.map((doc) => (
                    <ClaudeDocumentCard
                      key={doc.id}
                      document={doc}
                      onClick={() => onDocumentSelect(doc)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New AI Document Button */}
      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <span>+</span> New AI Document
        </button>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateDocumentModal
          groupId={groupId}
          onClose={() => setShowCreateModal(false)}
          onCreated={(doc) => {
            setClaudeDocs((prev) => [doc, ...prev])
            setShowCreateModal(false)
            onDocumentSelect(doc)
          }}
        />
      )}
    </div>
  )
}

interface FileCardProps {
  file: Document
  groupId: string
  onDelete: () => void
  onReferenceToggle: (isReference: boolean) => void
  compact?: boolean
}

function FileCard({ file, groupId, onDelete, onReferenceToggle, compact }: FileCardProps) {
  const [isTogglingRef, setIsTogglingRef] = useState(false)

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

  const handleReferenceToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isTogglingRef) return

    setIsTogglingRef(true)
    try {
      await filesApi.setReference(file.id, groupId, !file.is_reference)
      onReferenceToggle(!file.is_reference)
    } catch (err) {
      console.error('Failed to toggle reference:', err)
    } finally {
      setIsTogglingRef(false)
    }
  }

  if (compact) {
    return (
      <div className="py-2 px-3 hover:bg-zinc-800/50 transition-colors flex items-center gap-2 group">
        <span className="text-sm">{getFileIcon(file.file_type)}</span>
        {file.is_reference && (
          <span className="text-xs" title="Reference doc - Brain uses this as guidelines">📌</span>
        )}
        <span className="text-sm truncate flex-1">{file.filename}</span>
        <span className="text-xs text-zinc-500">{formatFileSize(file.file_size)}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleReferenceToggle}
            disabled={isTogglingRef}
            className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
              file.is_reference
                ? 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/30'
                : 'hover:bg-zinc-700 text-zinc-400 hover:text-amber-400'
            }`}
            title={file.is_reference ? 'Remove as reference (Brain stops using as guidelines)' : 'Use as reference (Brain uses as guidelines)'}
          >
            📌
          </button>
          <a
            href={`https://brain-trust-worker.e-caa.workers.dev/api/documents/${file.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-6 h-6 rounded hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white text-xs"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            ↓
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="w-6 h-6 rounded hover:bg-red-900/50 flex items-center justify-center text-zinc-400 hover:text-red-400 text-xs"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 hover:bg-zinc-800 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center shrink-0 text-lg">
          {getFileIcon(file.file_type)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate">{file.filename}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {formatFileSize(file.file_size)} &middot;{' '}
            {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {file.is_reference && (
              <span className="text-xs bg-amber-600/20 text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                <span>📌</span> Reference
              </span>
            )}
            {file.has_embedding && (
              <span className="text-xs bg-green-600/20 text-green-400 px-1.5 py-0.5 rounded">
                Indexed
              </span>
            )}
            {file.tags && file.tags.length > 0 && (
              <div className="flex gap-1">
                {file.tags.slice(0, 2).map(tag => (
                  <span
                    key={tag.id}
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: tag.color + '20', color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleReferenceToggle}
            disabled={isTogglingRef}
            className={`w-7 h-7 rounded flex items-center justify-center text-xs transition-colors ${
              file.is_reference
                ? 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/30'
                : 'hover:bg-zinc-700 text-zinc-400 hover:text-amber-400'
            }`}
            title={file.is_reference ? 'Remove as reference' : 'Use as reference for Brain'}
          >
            📌
          </button>
          <a
            href={`https://brain-trust-worker.e-caa.workers.dev/api/documents/${file.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 rounded hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white text-xs"
            title="Download"
          >
            ↓
          </a>
          <button
            onClick={onDelete}
            className="w-7 h-7 rounded hover:bg-red-900/50 flex items-center justify-center text-zinc-400 hover:text-red-400 text-xs"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

interface ClaudeDocumentCardProps {
  document: ClaudeDocument
  onClick: () => void
}

function ClaudeDocumentCard({ document, onClick }: ClaudeDocumentCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full p-3 text-left hover:bg-zinc-800 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded bg-cyan-600/20 flex items-center justify-center text-cyan-400 shrink-0">
          🧠
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate">{document.title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {document.creator_name} &middot;{' '}
            {formatDistanceToNow(new Date(document.updated_at), { addSuffix: true })}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {document.is_shared && (
              <span className="text-xs bg-green-600/20 text-green-400 px-1.5 py-0.5 rounded">
                Shared
              </span>
            )}
            <span className="text-xs text-zinc-600">
              {document.message_count} messages
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

interface CreateDocumentModalProps {
  groupId: string
  onClose: () => void
  onCreated: (doc: ClaudeDocument) => void
}

function CreateDocumentModal({ groupId, onClose, onCreated }: CreateDocumentModalProps) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    if (!title.trim() || !prompt.trim()) return

    setIsCreating(true)
    try {
      const res = await docsApi.create(groupId, title, prompt)
      onCreated(res.document)
    } catch (err) {
      console.error('Failed to create document:', err)
      alert('Failed to create document')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-xl p-4 w-full max-w-md">
        <h3 className="font-medium mb-4">New AI Document</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting notes, analysis, etc."
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Initial prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What would you like Claude to help with?"
              rows={4}
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || !prompt.trim() || isCreating}
            className="flex-1 bg-cyan-600 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
