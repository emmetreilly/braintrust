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
  const [isExpanded, setIsExpanded] = useState(false)
  const { groupId } = useParams<{ groupId: string }>()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadChannels()
  }, [groupId])

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
      {/* Expandable sidebar */}
      <div
        className={`h-full bg-zinc-950 border-r border-zinc-800 flex flex-col shrink-0 transition-all duration-200 ${
          isExpanded ? 'w-48' : 'w-12'
        }`}
      >
        {/* Top spacer for macOS traffic lights */}
        <div className="h-10 shrink-0" />

        {/* Channels section header (only when expanded) */}
        {isExpanded && (
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Channels</span>
          </div>
        )}

        {/* Channels - scrollable */}
        <div className="flex-1 overflow-auto py-2">
          <div className={`flex flex-col ${isExpanded ? 'px-2' : 'items-center'} gap-1`}>
            {isLoading ? (
              <div className={`${isExpanded ? 'h-8 mx-1' : 'w-8 h-8'} rounded bg-zinc-800 animate-pulse`} />
            ) : (
              channels.map((channel) => {
                const isActive = channel.id === groupId
                return (
                  <button
                    key={channel.id}
                    onClick={() => navigate(`/chat/${channel.id}`)}
                    className={`${
                      isExpanded
                        ? 'w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm text-left'
                        : 'w-10 h-10 rounded-lg flex items-center justify-center text-sm font-medium'
                    } transition-colors ${
                      isActive
                        ? 'bg-zinc-700 text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                    title={isExpanded ? undefined : channel.name}
                  >
                    {isExpanded ? (
                      <>
                        <span className="text-zinc-500">#</span>
                        <span className="truncate">{channel.name.toLowerCase().replace(/\s+/g, '-')}</span>
                      </>
                    ) : (
                      channel.name.charAt(0).toUpperCase()
                    )}
                  </button>
                )
              })
            )}

            {/* Add channel */}
            <button
              onClick={onCreateChannel}
              className={`${
                isExpanded
                  ? 'w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm text-left text-zinc-500 hover:text-white hover:bg-zinc-800'
                  : 'w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-zinc-500'
              } transition-colors`}
              title={isExpanded ? undefined : 'New Channel'}
            >
              {isExpanded ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add Channel</span>
                </>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Bottom icons */}
        <div className={`${isExpanded ? 'px-2' : ''} py-2 border-t border-zinc-800`}>
          <div className={`flex flex-col ${isExpanded ? '' : 'items-center'} gap-1`}>
            {/* Expand/Collapse toggle */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`${
                isExpanded
                  ? 'w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm'
                  : 'w-10 h-10 rounded-lg flex items-center justify-center'
              } text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors`}
              title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              {isExpanded && <span>Collapse</span>}
            </button>

            {/* Join */}
            <button
              onClick={() => setShowJoin(true)}
              className={`${
                isExpanded
                  ? 'w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm'
                  : 'w-10 h-10 rounded-lg flex items-center justify-center'
              } text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors`}
              title={isExpanded ? undefined : 'Join Channel'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              {isExpanded && <span>Join Channel</span>}
            </button>

            {/* Settings */}
            <button
              onClick={() => navigate('/settings')}
              className={`${
                isExpanded
                  ? 'w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm'
                  : 'w-10 h-10 rounded-lg flex items-center justify-center'
              } text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors`}
              title={isExpanded ? undefined : 'Settings'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {isExpanded && <span>Settings</span>}
            </button>

            {/* User avatar */}
            <button
              onClick={logout}
              className={`${
                isExpanded
                  ? 'w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm'
                  : 'w-10 h-10 rounded-full flex items-center justify-center'
              } ${isExpanded ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'bg-zinc-700 hover:bg-zinc-600 text-white'} transition-colors`}
              title={isExpanded ? undefined : `${user?.name} - Sign out`}
            >
              {isExpanded ? (
                <>
                  <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium">
                    {user?.name?.charAt(0) || '?'}
                  </div>
                  <span className="truncate">{user?.name || 'Sign out'}</span>
                </>
              ) : (
                <span className="text-xs font-medium">{user?.name?.charAt(0) || '?'}</span>
              )}
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
