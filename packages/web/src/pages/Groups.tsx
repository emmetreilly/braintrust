import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { groups as groupsApi } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import type { Group } from '../types'

export default function Groups() {
  const [channels, setChannels] = useState<Group[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')

  const { user, workspace, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadChannels()
  }, [])

  const loadChannels = async () => {
    try {
      const { groups: data } = await groupsApi.list()
      setChannels(data)
    } catch (err) {
      console.error('Failed to load channels:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const { group } = await groupsApi.create(newChannelName)
      setChannels([...channels, group])
      setNewChannelName('')
      setShowCreate(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleJoinChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const { group } = await groupsApi.join(inviteCode)
      setChannels([...channels, group])
      setInviteCode('')
      setShowJoin(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <div className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        {/* Workspace Header */}
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center font-bold text-lg">
              {workspace?.name?.charAt(0) || 'W'}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold truncate">{workspace?.name || 'Workspace'}</h1>
              <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="p-3 border-b border-zinc-800 space-y-1">
          <a
            href="https://claude.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <span>Open Claude</span>
            <span className="ml-auto text-xs text-zinc-600">↗</span>
          </a>
          <button
            onClick={() => navigate('/search')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <span>🔍</span>
            <span>Search Docs</span>
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <span className="text-lg">+</span>
            <span>New Channel</span>
          </button>
        </div>

        {/* Channels List */}
        <div className="flex-1 overflow-auto p-2">
          <div className="px-2 py-1 text-xs text-zinc-500 font-medium uppercase tracking-wider">
            Channels
          </div>
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-zinc-500">Loading...</div>
          ) : channels.length === 0 ? (
            <div className="px-3 py-4 text-sm text-zinc-500 text-center">
              No channels yet
            </div>
          ) : (
            <div className="space-y-0.5">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => navigate(`/chat/${channel.id}`)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-800 text-sm text-left transition-colors group"
                >
                  <span className="text-zinc-500 group-hover:text-zinc-300">#</span>
                  <span className="flex-1 truncate">{channel.name.toLowerCase().replace(/\s+/g, '-')}</span>
                </button>
              ))}
            </div>
          )}

          {/* Join with Code */}
          <div className="mt-4 px-2 py-1 text-xs text-zinc-500 font-medium uppercase tracking-wider">
            Join
          </div>
          <button
            onClick={() => setShowJoin(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-800 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <span>🔗</span>
            <span>Join with code</span>
          </button>
        </div>

        {/* User Footer */}
        <div className="p-3 border-t border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center text-sm font-medium">
              {user?.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
            </div>
            <button
              onClick={() => navigate('/settings')}
              className="text-zinc-500 hover:text-white p-1"
              title="Settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={logout}
              className="text-zinc-500 hover:text-white p-1"
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Welcome Header */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-lg">
            <div className="text-6xl mb-6">🧠</div>
            <h1 className="text-3xl font-bold mb-4">Welcome to {workspace?.name || 'Brain Trust'}</h1>
            <p className="text-zinc-400 mb-8">
              Your AI-powered workspace. Create channels for your team, share documents,
              and let Brain help you stay on top of everything.
            </p>

            <div className="grid grid-cols-2 gap-4 text-left">
              <div className="bg-zinc-900 rounded-xl p-4">
                <div className="text-2xl mb-2">💬</div>
                <h3 className="font-medium mb-1">Chat with @brain</h3>
                <p className="text-sm text-zinc-500">Ask questions, get summaries, catch up on what you missed</p>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4">
                <div className="text-2xl mb-2">📄</div>
                <h3 className="font-medium mb-1">Upload Documents</h3>
                <p className="text-sm text-zinc-500">PDFs, transcripts, contracts - all indexed and searchable</p>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4">
                <div className="text-2xl mb-2">🔍</div>
                <h3 className="font-medium mb-1">Search Everything</h3>
                <p className="text-sm text-zinc-500">"What did we decide about pricing?" - Brain remembers</p>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4">
                <div className="text-2xl mb-2">📝</div>
                <h3 className="font-medium mb-1">Get Updates</h3>
                <p className="text-sm text-zinc-500">Drop a transcript, get action items and next steps</p>
              </div>
            </div>

            {channels.length === 0 && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-8 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-zinc-200 transition-colors"
              >
                Create your first channel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Create Channel Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Create Channel</h2>
            <form onSubmit={handleCreateChannel}>
              <div className="mb-4">
                <label className="text-sm text-zinc-400 block mb-2">Channel name</label>
                <div className="flex items-center bg-zinc-800 rounded-lg">
                  <span className="pl-4 text-zinc-500">#</span>
                  <input
                    type="text"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="sales-team"
                    className="flex-1 bg-transparent px-2 py-3 text-sm focus:outline-none"
                    required
                    autoFocus
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Channels are where your team communicates. Create one for each project, topic, or team.
                </p>
              </div>
              {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 bg-zinc-800 rounded-lg py-2.5 text-sm hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200 transition-colors"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Channel Modal */}
      {showJoin && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Join Channel</h2>
            <form onSubmit={handleJoinChannel}>
              <div className="mb-4">
                <label className="text-sm text-zinc-400 block mb-2">Invite code</label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 uppercase tracking-widest text-center font-mono"
                  required
                  autoFocus
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Ask the channel admin for the invite code
                </p>
              </div>
              {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowJoin(false)}
                  className="flex-1 bg-zinc-800 rounded-lg py-2.5 text-sm hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200 transition-colors"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
