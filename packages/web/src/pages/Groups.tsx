import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { groups as groupsApi } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import ChannelSidebar from '../components/ChannelSidebar'
import type { Group } from '../types'

export default function Groups() {
  const [channels, setChannels] = useState<Group[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [error, setError] = useState('')

  const { workspace } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadChannels()
  }, [])

  // Auto-navigate to first channel if available
  useEffect(() => {
    if (!isLoading && channels.length > 0) {
      navigate(`/chat/${channels[0].id}`, { replace: true })
    }
  }, [isLoading, channels, navigate])

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
      setNewChannelName('')
      setShowCreate(false)
      navigate(`/chat/${group.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Left: Channel Sidebar - Same as Chat page */}
      <div className="h-screen flex-shrink-0">
        <ChannelSidebar onCreateChannel={() => setShowCreate(true)} />
      </div>

      {/* Main Content - Welcome/Onboarding when no channels selected */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-lg">
            {isLoading ? (
              <div className="text-zinc-500">Loading...</div>
            ) : channels.length === 0 ? (
              <>
                <h1 className="text-3xl font-bold mb-4">Welcome to {workspace?.name || 'Brain Trust'}</h1>
                <p className="text-zinc-400 mb-8">
                  Create your first channel to get started.
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-zinc-200 transition-colors"
                >
                  Create your first channel
                </button>
              </>
            ) : (
              <div className="text-zinc-500">Select a channel from the sidebar</div>
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
                  Channels are where your team communicates.
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
    </div>
  )
}
