import { useState } from 'react'

interface SearchResultsProps {
  query: string
  result: {
    answer: string
    context: {
      people: Array<{ name: string; email: string; messageCount: number; filesShared: number }>
      timeline: Array<{ date: string; event: string; source: string }>
    }
    sources: Array<{
      id: string
      title: string
      snippet: string
      source: 'slack' | 'google_drive' | 'gmail' | 'hubspot'
      url: string
      author?: string
      date: string
    }>
  }
  onNewSearch: (query: string) => void
  onBack: () => void
  onOpenSource: (url: string, title: string) => void
}

export default function SearchResults({
  query,
  result,
  onNewSearch,
  onBack,
  onOpenSource,
}: SearchResultsProps) {
  const [followUpQuery, setFollowUpQuery] = useState('')
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(result.answer)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleEmail = () => {
    const subject = encodeURIComponent(`Brain Trust: ${query}`)
    const body = encodeURIComponent(`${result.answer}\n\n---\nSources:\n${result.sources.map(s => `• ${s.title} (${s.source})`).join('\n')}`)
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  const handleSlackShare = () => {
    // For now, just copy - later integrate with Slack API
    const text = `🧠 *Brain Trust Summary*\n\n${result.answer}\n\n_Sources:_\n${result.sources.map(s => `• ${s.title}`).join('\n')}`
    navigator.clipboard.writeText(text)
    alert('Summary copied! Paste it in Slack.')
  }

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'slack': return '💬'
      case 'google_drive': return '📄'
      case 'gmail': return '📧'
      case 'hubspot': return '🔶'
      default: return '📁'
    }
  }

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'slack': return 'Slack'
      case 'google_drive': return 'Drive'
      case 'gmail': return 'Gmail'
      case 'hubspot': return 'Hubspot'
      default: return source
    }
  }

  return (
    <div className="w-full max-w-3xl">
      {/* Back button and search bar */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => onNewSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">🔍</span>
        </div>
      </div>

      {/* Answer card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-4">
        <p className="text-lg leading-relaxed whitespace-pre-wrap">{result.answer}</p>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-zinc-800">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
          <button
            onClick={handleEmail}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            📧 Email
          </button>
          <button
            onClick={handleSlackShare}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            💬 Share to Slack
          </button>
        </div>
      </div>

      {/* Key People */}
      {result.context.people.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">👥 Key People</h3>
          <div className="flex flex-wrap gap-3">
            {result.context.people.map((person, i) => (
              <div key={i} className="bg-zinc-800 rounded-xl p-3 min-w-[140px]">
                <div className="font-medium text-sm">{person.name}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  {person.messageCount} msgs · {person.filesShared} files
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => window.open(`mailto:${person.email}`)}
                    className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                  >
                    Email
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      {result.sources.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">📎 Sources ({result.sources.length})</h3>
          <div className="space-y-3">
            {result.sources.map((source) => (
              <div
                key={source.id}
                className="bg-zinc-800 rounded-xl p-4 hover:bg-zinc-750 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{getSourceIcon(source.source)}</span>
                    <div>
                      <div className="font-medium text-sm">{source.title}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {getSourceLabel(source.source)} · {source.date}
                        {source.author && ` · ${source.author}`}
                      </div>
                      {source.snippet && (
                        <p className="text-sm text-zinc-400 mt-2 line-clamp-2">
                          "{source.snippet}"
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onOpenSource(source.url, source.title)}
                      className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs transition-colors"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => window.open(source.url, '_blank')}
                      className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs transition-colors"
                      title="Open in new tab"
                    >
                      ↗
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      {result.context.timeline.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">📅 Timeline</h3>
          <div className="space-y-2">
            {result.context.timeline.map((event, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="text-zinc-500 w-20 flex-shrink-0">{event.date}</span>
                <span>{event.event}</span>
                <span className="text-zinc-600 text-xs">({event.source})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up input */}
      <div className="border-t border-zinc-800 pt-4 mt-6">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (followUpQuery.trim()) {
              onNewSearch(followUpQuery)
              setFollowUpQuery('')
            }
          }}
          className="relative"
        >
          <input
            type="text"
            value={followUpQuery}
            onChange={(e) => setFollowUpQuery(e.target.value)}
            placeholder="Ask a follow-up question..."
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button
            type="submit"
            disabled={!followUpQuery.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
