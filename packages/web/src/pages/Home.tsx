import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { integrations as integrationsApi, search as searchApi } from '../lib/api'
import SearchResults from '../components/Search/SearchResults'
import SourceCard from '../components/Search/SourceCard'
import WebContainer from '../components/Search/WebContainer'

interface Integration {
  id: string
  provider: 'slack' | 'google_drive' | 'gmail' | 'hubspot'
  status: 'active' | 'syncing' | 'error' | 'disconnected'
  items_indexed: number
  last_sync_at?: string
}

interface SearchResult {
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

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [integrationsList, setIntegrationsList] = useState<Integration[]>([])
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [webContainerUrl, setWebContainerUrl] = useState<string | null>(null)
  const [webContainerTitle, setWebContainerTitle] = useState<string>('')

  useEffect(() => {
    loadIntegrations()
    loadRecentQueries()
  }, [])

  const loadIntegrations = async () => {
    try {
      const res = await integrationsApi.list()
      setIntegrationsList(res.integrations || [])
    } catch (err) {
      console.error('Failed to load integrations:', err)
    } finally {
      setIsLoadingIntegrations(false)
    }
  }

  const loadRecentQueries = async () => {
    try {
      const res = await searchApi.recent()
      setRecentQueries(res.queries?.map((q: any) => q.query) || [])
    } catch {
      // Ignore - may not have history yet
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsSearching(true)
    setSearchResult(null)

    try {
      const res = await searchApi.query(query)
      setSearchResult(res)
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleConnect = async (provider: 'slack' | 'google_drive' | 'gmail' | 'hubspot') => {
    try {
      let res
      if (provider === 'slack') {
        res = await integrationsApi.connectSlack()
      } else if (provider === 'google_drive' || provider === 'gmail') {
        const services = provider === 'google_drive' ? ['drive'] : ['gmail']
        res = await integrationsApi.connectGoogle(services)
      } else {
        // Hubspot not implemented yet
        return
      }

      if (res.authUrl) {
        window.location.href = res.authUrl
      }
    } catch (err) {
      console.error('Connect error:', err)
    }
  }

  const handleOpenSource = (url: string, title: string) => {
    setWebContainerUrl(url)
    setWebContainerTitle(title)
  }

  const getIntegration = (provider: string) => {
    return integrationsList.find(i => i.provider === provider)
  }

  const totalIndexed = integrationsList.reduce((sum, i) => sum + i.items_indexed, 0)

  // If web container is open, show that
  if (webContainerUrl) {
    return (
      <WebContainer
        url={webContainerUrl}
        title={webContainerTitle}
        onBack={() => setWebContainerUrl(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="absolute top-4 right-4 flex items-center gap-3">
        <button
          onClick={() => navigate('/settings')}
          className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        {user && (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xs font-medium">
            {user.name?.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-col items-center justify-center min-h-screen px-4 py-16">
        {!searchResult ? (
          // Home state - search input
          <div className="w-full max-w-2xl">
            {/* Logo */}
            <div className="text-center mb-8">
              <div className="text-5xl mb-3">🧠</div>
              <h1 className="text-2xl font-semibold">Brain Trust</h1>
              <p className="text-zinc-500 text-sm mt-1">Ask anything about your workspace</p>
            </div>

            {/* Search input */}
            <form onSubmit={handleSearch} className="mb-6">
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="What's the latest on the Acme deal?"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent placeholder-zinc-500"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSearching || !query.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                >
                  {isSearching ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  )}
                </button>
              </div>
            </form>

            {/* Recent queries */}
            {recentQueries.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
                <span className="text-zinc-600 text-sm">Recent:</span>
                {recentQueries.slice(0, 4).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setQuery(q)}
                    className="px-3 py-1.5 bg-zinc-800/50 hover:bg-zinc-800 rounded-full text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Connected sources */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SourceCard
                name="Slack"
                icon="💬"
                connected={!!getIntegration('slack')}
                itemCount={getIntegration('slack')?.items_indexed}
                status={getIntegration('slack')?.status}
                onConnect={() => handleConnect('slack')}
                onOpen={() => handleOpenSource('https://app.slack.com', 'Slack')}
              />
              <SourceCard
                name="G Drive"
                icon="📁"
                connected={!!getIntegration('google_drive')}
                itemCount={getIntegration('google_drive')?.items_indexed}
                status={getIntegration('google_drive')?.status}
                onConnect={() => handleConnect('google_drive')}
                onOpen={() => handleOpenSource('https://drive.google.com', 'Google Drive')}
              />
              <SourceCard
                name="Gmail"
                icon="📧"
                connected={!!getIntegration('gmail')}
                itemCount={getIntegration('gmail')?.items_indexed}
                status={getIntegration('gmail')?.status}
                onConnect={() => handleConnect('gmail')}
                onOpen={() => handleOpenSource('https://mail.google.com', 'Gmail')}
              />
              <SourceCard
                name="Hubspot"
                icon="🔶"
                connected={!!getIntegration('hubspot')}
                itemCount={getIntegration('hubspot')?.items_indexed}
                status={getIntegration('hubspot')?.status}
                onConnect={() => handleConnect('hubspot')}
                onOpen={() => handleOpenSource('https://app.hubspot.com', 'Hubspot')}
                comingSoon
              />
            </div>

            {/* Sync status */}
            {totalIndexed > 0 && (
              <p className="text-center text-zinc-600 text-xs mt-4">
                {totalIndexed.toLocaleString()} items indexed
                {integrationsList.some(i => i.last_sync_at) && (
                  <> · Last synced {new Date(integrationsList.find(i => i.last_sync_at)!.last_sync_at!).toLocaleTimeString()}</>
                )}
              </p>
            )}
          </div>
        ) : (
          // Search results
          <SearchResults
            query={query}
            result={searchResult}
            onNewSearch={(q) => {
              setQuery(q)
              setSearchResult(null)
            }}
            onBack={() => setSearchResult(null)}
            onOpenSource={handleOpenSource}
          />
        )}
      </div>
    </div>
  )
}
