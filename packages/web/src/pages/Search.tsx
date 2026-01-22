import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { files as filesApi } from '../lib/api'
import type { Document, DocumentTag } from '../types'

export default function Search() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [results, setResults] = useState<Document[]>([])
  const [allDocs, setAllDocs] = useState<Document[]>([])
  const [tags, setTags] = useState<DocumentTag[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(searchParams.get('tag'))
  const [selectedType, setSelectedType] = useState<string | null>(searchParams.get('type'))
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    // Filter/search when params change
    if (query.trim()) {
      performSearch()
    } else {
      filterDocs()
    }
  }, [query, selectedTag, selectedType, allDocs])

  const loadInitialData = async () => {
    setIsLoading(true)
    try {
      const [docsRes, tagsRes] = await Promise.all([
        filesApi.list(),
        filesApi.listTags(),
      ])
      setAllDocs(docsRes.documents)
      setTags(tagsRes.tags)

      // Initial filter
      filterDocs(docsRes.documents)
    } catch (err) {
      console.error('Failed to load docs:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const filterDocs = (docs = allDocs) => {
    let filtered = [...docs]

    if (selectedTag) {
      filtered = filtered.filter(d => d.tags?.some(t => t.id === selectedTag))
    }

    if (selectedType) {
      filtered = filtered.filter(d => d.file_type === selectedType)
    }

    setResults(filtered)
  }

  const performSearch = async () => {
    if (!query.trim()) {
      filterDocs()
      return
    }

    setIsSearching(true)
    try {
      // Use semantic search API
      const res = await filesApi.search(query, 20)
      let searchResults = res.documents

      // Apply tag/type filters
      if (selectedTag) {
        searchResults = searchResults.filter((d: any) => d.tags?.some((t: any) => t.id === selectedTag))
      }
      if (selectedType) {
        searchResults = searchResults.filter((d: any) => d.file_type === selectedType)
      }

      setResults(searchResults)
    } catch (err) {
      console.error('Search error:', err)
      // Fallback to local text search
      const q = query.toLowerCase()
      let filtered = allDocs.filter(d =>
        d.filename.toLowerCase().includes(q) ||
        d.content_text?.toLowerCase().includes(q)
      )

      if (selectedTag) {
        filtered = filtered.filter(d => d.tags?.some(t => t.id === selectedTag))
      }
      if (selectedType) {
        filtered = filtered.filter(d => d.file_type === selectedType)
      }

      setResults(filtered)
    } finally {
      setIsSearching(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchParams({ q: query, ...(selectedTag ? { tag: selectedTag } : {}), ...(selectedType ? { type: selectedType } : {}) })
    performSearch()
  }

  const setTagFilter = (tagId: string | null) => {
    setSelectedTag(tagId)
    const params: any = {}
    if (query) params.q = query
    if (tagId) params.tag = tagId
    if (selectedType) params.type = selectedType
    setSearchParams(params)
  }

  const setTypeFilter = (type: string | null) => {
    setSelectedType(type)
    const params: any = {}
    if (query) params.q = query
    if (selectedTag) params.tag = selectedTag
    if (type) params.type = type
    setSearchParams(params)
  }

  const fileTypes = ['text', 'pdf', 'doc', 'spreadsheet', 'image', 'other']

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf': return '📕'
      case 'doc': return '📘'
      case 'spreadsheet': return '📊'
      case 'image': return '🖼️'
      case 'text': return '📄'
      default: return '📁'
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/groups')}
              className="text-zinc-400 hover:text-white"
            >
              ←
            </button>
            <h1 className="font-semibold">Search Documents</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {/* Search Input */}
        <form onSubmit={handleSearch} className="mb-4">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for documents... (e.g., 'Newell meeting notes')"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              autoFocus
            />
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500">
              🔍
            </span>
            {isSearching && (
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">
                ...
              </span>
            )}
          </div>
        </form>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          {/* Tag filter */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => setTagFilter(selectedTag === tag.id ? null : tag.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedTag === tag.id
                      ? 'ring-2 ring-white'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: `${tag.color}30`, color: tag.color }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          {/* Type filter */}
          <div className="flex gap-1.5 ml-auto">
            {fileTypes.map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(selectedType === type ? null : type)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  selectedType === type
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {getFileIcon(type)}
              </button>
            ))}
          </div>
        </div>

        {/* Active filters display */}
        {(selectedTag || selectedType) && (
          <div className="flex items-center gap-2 mb-4 text-sm">
            <span className="text-zinc-500">Filtering by:</span>
            {selectedTag && (
              <span
                className="px-2 py-1 rounded-full text-xs"
                style={{
                  backgroundColor: `${tags.find(t => t.id === selectedTag)?.color}30`,
                  color: tags.find(t => t.id === selectedTag)?.color,
                }}
              >
                {tags.find(t => t.id === selectedTag)?.name}
                <button onClick={() => setTagFilter(null)} className="ml-1 opacity-70 hover:opacity-100">×</button>
              </span>
            )}
            {selectedType && (
              <span className="px-2 py-1 rounded-full text-xs bg-zinc-800 text-zinc-300">
                {selectedType}
                <button onClick={() => setTypeFilter(null)} className="ml-1 opacity-70 hover:opacity-100">×</button>
              </span>
            )}
            <button
              onClick={() => { setTagFilter(null); setTypeFilter(null) }}
              className="text-xs text-zinc-500 hover:text-white ml-2"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Results */}
        {isLoading ? (
          <div className="text-center py-12 text-zinc-500">Loading documents...</div>
        ) : results.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📂</div>
            <p className="text-zinc-500">
              {query ? `No documents found for "${query}"` : 'No documents yet'}
            </p>
            <p className="text-xs text-zinc-600 mt-2">
              Upload documents in channel settings to make them searchable
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 mb-3">
              {results.length} document{results.length !== 1 ? 's' : ''} found
            </p>
            {results.map(doc => (
              <div
                key={doc.id}
                className="bg-zinc-900 rounded-xl p-4 hover:bg-zinc-800/70 transition-colors cursor-pointer"
                onClick={() => {
                  // Could open a preview modal or download
                  window.open(filesApi.download(doc.id), '_blank')
                }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getFileIcon(doc.file_type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{doc.filename}</div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
                      <span>{formatFileSize(doc.file_size)}</span>
                      <span>•</span>
                      <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                      {doc.uploader && (
                        <>
                          <span>•</span>
                          <span>by {doc.uploader.name}</span>
                        </>
                      )}
                    </div>
                    {/* Tags */}
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {doc.tags.map(tag => (
                          <span
                            key={tag.id}
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                            style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Content preview */}
                    {doc.content_text && query && (
                      <p className="text-xs text-zinc-400 mt-2 line-clamp-2">
                        {doc.content_text.slice(0, 200)}...
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
