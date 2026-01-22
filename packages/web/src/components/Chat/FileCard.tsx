import { useState } from 'react'
import { useDrag } from 'react-dnd'
import { files as filesApi } from '../../lib/api'
import { DragTypes } from '../ui/DragDropContext'
import type { Document } from '../../types'

interface FileCardProps {
  document: Document
  onView?: () => void
}

// File type icons and colors - using SVG icons instead of emojis
const FILE_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  pdf: { icon: 'pdf', color: 'text-red-400', bg: 'bg-red-500/10' },
  doc: { icon: 'doc', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  docx: { icon: 'doc', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  xls: { icon: 'xls', color: 'text-green-400', bg: 'bg-green-500/10' },
  xlsx: { icon: 'xls', color: 'text-green-400', bg: 'bg-green-500/10' },
  csv: { icon: 'csv', color: 'text-green-400', bg: 'bg-green-500/10' },
  ppt: { icon: 'ppt', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  pptx: { icon: 'ppt', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  txt: { icon: 'txt', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
  md: { icon: 'md', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
  json: { icon: 'json', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  png: { icon: 'img', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  jpg: { icon: 'img', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  jpeg: { icon: 'img', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  gif: { icon: 'img', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  default: { icon: 'file', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
}

// Simple file icon component
function FileIcon({ type, className }: { type: string; className?: string }) {
  return (
    <svg className={className || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      {type !== 'file' && (
        <text x="12" y="16" textAnchor="middle" fontSize="6" fill="currentColor" stroke="none" className="font-mono uppercase">
          {type.slice(0, 3)}
        </text>
      )}
    </svg>
  )
}

function getFileInfo(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return FILE_ICONS[ext] || FILE_ICONS.default
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FileCard({ document, onView }: FileCardProps) {
  const { icon, color } = getFileInfo(document.filename)
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(
    document.filename.split('.').pop()?.toLowerCase() || ''
  )

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(filesApi.download(document.id), '_blank')
  }

  return (
    <div
      onClick={onView}
      className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden cursor-pointer hover:border-zinc-700 transition-colors max-w-sm"
    >
      {/* Image preview if it's an image */}
      {isImage && (
        <div className="w-full h-40 bg-zinc-800 flex items-center justify-center">
          <img
            src={filesApi.download(document.id)}
            alt={document.filename}
            className="max-w-full max-h-full object-contain"
            onError={(e) => {
              // Hide image on error
              (e.target as HTMLElement).style.display = 'none'
            }}
          />
        </div>
      )}

      <div className="p-3">
        <div className="flex items-start gap-3">
          <FileIcon type={icon} className={`w-6 h-6 ${color}`} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate" title={document.filename}>
              {document.filename}
            </p>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
              <span>{formatFileSize(document.file_size)}</span>
              <span>-</span>
              <span>{document.file_type.toUpperCase()}</span>
              {document.has_embedding && (
                <>
                  <span>-</span>
                  <span className="text-cyan-500">Indexed</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={handleDownload}
            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
            title="Download"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>

        {/* Tags if any */}
        {document.tags && document.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {document.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 text-xs rounded-full"
                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {document.tags.length > 3 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-zinc-800 text-zinc-400">
                +{document.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Minimal file share line for chat messages - single line, no borders
// Drag to Brain to ask questions, click to expand
export function FileShareLine({
  filename,
  sharedBy,
  documentId,
  summary,
}: {
  filename: string
  sharedBy?: string
  documentId?: string
  summary?: string | null
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { icon, color } = getFileInfo(filename)

  // Make draggable to Brain
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DragTypes.MEDIA_FILE,
    item: {
      type: DragTypes.MEDIA_FILE,
      fileId: documentId || '',
      filename: filename,
      fileType: filename.split('.').pop() || 'file',
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [documentId, filename])

  return (
    <div
      ref={drag}
      className={`${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Minimal single line */}
      <div
        className="flex items-center gap-2 py-1 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <FileIcon type={icon} className={`w-4 h-4 ${color} flex-shrink-0`} />
        <span className="text-sm truncate">{filename}</span>
        {sharedBy && (
          <span className="text-xs text-zinc-500 flex-shrink-0">- shared by {sharedBy}</span>
        )}
        {documentId && (
          <a
            href={filesApi.download(documentId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white transition-opacity"
            title="Download"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        )}
      </div>

      {/* Expanded view - inline, shows summary if available */}
      {isExpanded && summary && (
        <div className="ml-6 mt-2 mb-2 text-sm text-zinc-400 border-l-2 border-zinc-700 pl-3">
          <p>{summary}</p>
        </div>
      )}
    </div>
  )
}

// Legacy export for backwards compatibility
export function FileCardInline({
  filename,
  documentId,
  summary,
}: {
  filename: string
  fileSize?: number
  fileType?: string
  documentId?: string
  summary?: string | null
  onAskBrain?: () => void
}) {
  return (
    <FileShareLine
      filename={filename}
      documentId={documentId}
      summary={summary}
    />
  )
}
