import { files as filesApi } from '../../lib/api'
import type { Document } from '../../types'

interface FileCardProps {
  document: Document
  onView?: () => void
}

// File type icons and colors
const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  pdf: { icon: '📄', color: 'text-red-400' },
  doc: { icon: '📝', color: 'text-blue-400' },
  docx: { icon: '📝', color: 'text-blue-400' },
  xls: { icon: '📊', color: 'text-green-400' },
  xlsx: { icon: '📊', color: 'text-green-400' },
  csv: { icon: '📊', color: 'text-green-400' },
  ppt: { icon: '📽️', color: 'text-orange-400' },
  pptx: { icon: '📽️', color: 'text-orange-400' },
  txt: { icon: '📃', color: 'text-zinc-400' },
  md: { icon: '📃', color: 'text-zinc-400' },
  json: { icon: '{ }', color: 'text-yellow-400' },
  png: { icon: '🖼️', color: 'text-purple-400' },
  jpg: { icon: '🖼️', color: 'text-purple-400' },
  jpeg: { icon: '🖼️', color: 'text-purple-400' },
  gif: { icon: '🖼️', color: 'text-purple-400' },
  default: { icon: '📎', color: 'text-zinc-400' },
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
          <div className={`text-2xl ${color}`}>{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate" title={document.filename}>
              {document.filename}
            </p>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
              <span>{formatFileSize(document.file_size)}</span>
              <span>·</span>
              <span>{document.file_type.toUpperCase()}</span>
              {document.has_embedding && (
                <>
                  <span>·</span>
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

// Simpler inline version for message list
export function FileCardInline({ filename, fileSize, fileType, documentId, summary, onAskBrain }: {
  filename: string
  fileSize?: number
  fileType?: string
  documentId?: string
  summary?: string | null
  onAskBrain?: () => void
}) {
  const { icon, color } = getFileInfo(filename)

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden max-w-md">
      <div className="p-3 flex items-center gap-3">
        <div className={`text-xl ${color}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{filename}</p>
          <div className="text-xs text-zinc-500">
            {fileSize && <span>{formatFileSize(fileSize)}</span>}
            {fileType && <span> · {fileType.toUpperCase()}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onAskBrain && (
            <button
              onClick={(e) => { e.stopPropagation(); onAskBrain() }}
              className="p-1.5 hover:bg-cyan-500/20 rounded text-cyan-500 hover:text-cyan-400 transition-colors"
              title="Ask Brain about this document"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          {documentId && (
            <a
              href={filesApi.download(documentId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white"
              title="Download"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
          )}
        </div>
      </div>
      {summary && (
        <div className="px-3 pb-3 pt-0">
          <p className="text-xs text-zinc-400 line-clamp-3">{summary}</p>
        </div>
      )}
    </div>
  )
}
