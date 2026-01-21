interface ClaudeDocumentCardProps {
  documentId: string
  title: string
  onClick: () => void
}

export default function ClaudeDocumentCard({ title, onClick }: ClaudeDocumentCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full max-w-xs bg-zinc-800 hover:bg-zinc-700 rounded-xl p-4 text-left transition-colors border border-zinc-700"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-cyan-600/20 flex items-center justify-center text-cyan-400 shrink-0">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-cyan-400 font-medium mb-0.5">Claude Document</p>
          <h4 className="font-medium text-sm truncate">{title}</h4>
          <p className="text-xs text-zinc-500 mt-1">Tap to view &amp; continue</p>
        </div>
      </div>
    </button>
  )
}

// Helper to check if media_data is a Claude document
export function isClaudeDocument(mediaData: string | undefined): { documentId: string; title: string } | null {
  if (!mediaData) return null
  try {
    const data = JSON.parse(mediaData)
    if (data.type === 'claude_document' && data.documentId) {
      return { documentId: data.documentId, title: data.title || 'Untitled' }
    }
  } catch {
    // Not JSON or not a claude document
  }
  return null
}
