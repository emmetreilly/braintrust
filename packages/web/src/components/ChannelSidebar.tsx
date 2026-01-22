import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { groups as groupsApi } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import type { Group } from '../types'

interface ChannelSidebarProps {
  onCreateChannel?: () => void
}

export default function ChannelSidebar({ onCreateChannel }: ChannelSidebarProps) {
  const [channels, setChannels] = useState<Group[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showJoin, setShowJoin] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const { groupId } = useParams<{ groupId: string }>()
  const { user, workspace, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadChannels()
  }, [groupId]) // Reload when switching channels (handles new channel creation)

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

  const handleJoinChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError('')

    try {
      const { group } = await groupsApi.join(inviteCode)
      setChannels([...channels, group])
      setInviteCode('')
      setShowJoin(false)
      navigate(`/chat/${group.id}`)
    } catch (err) {
      setJoinError((err as Error).message)
    }
  }

  return (
    <>
      <div className="w-64 h-full bg-zinc-950 border-r border-zinc-800 flex flex-col shrink-0">
        {/* Workspace Header */}
        <div className="p-4 border-b border-zinc-800">
          <button
            onClick={() => navigate('/groups')}
            className="flex items-center gap-3 w-full text-left hover:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center font-bold text-lg">
              {workspace?.name?.charAt(0) || 'W'}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold truncate">{workspace?.name || 'Workspace'}</h1>
              <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
            </div>
          </button>
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
            onClick={onCreateChannel}
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
              {channels.map((channel) => {
                const isActive = channel.id === groupId
                return (
                  <button
                    key={channel.id}
                    onClick={() => navigate(`/chat/${channel.id}`)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition-colors group ${
                      isActive
                        ? 'bg-zinc-800 text-white'
                        : 'hover:bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    <span className={isActive ? 'text-zinc-300' : 'text-zinc-500 group-hover:text-zinc-300'}>#</span>
                    <span className="flex-1 truncate">{channel.name.toLowerCase().replace(/\s+/g, '-')}</span>
                  </button>
                )
              })}
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
              {joinError && <p className="text-red-500 text-sm mb-4">{joinError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowJoin(false); setJoinError(''); setInviteCode(''); }}
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
    </>
  )
}
