import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { groups as groupsApi } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import type { Group } from '../types'

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')

  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadGroups()
  }, [])

  const loadGroups = async () => {
    try {
      const { groups: data } = await groupsApi.list()
      setGroups(data)
    } catch (err) {
      console.error('Failed to load groups:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const { group } = await groupsApi.create(newGroupName)
      setGroups([...groups, group])
      setNewGroupName('')
      setShowCreate(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const { group } = await groupsApi.join(inviteCode)
      setGroups([...groups, group])
      setInviteCode('')
      setShowJoin(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🧠</div>
            <div>
              <h1 className="font-semibold">Brain Trust</h1>
              <p className="text-xs text-zinc-500">Hi, {user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/settings')}
              className="text-sm text-zinc-500 hover:text-white"
            >
              Settings
            </button>
            <button
              onClick={logout}
              className="text-sm text-zinc-500 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto p-4">
        {/* Actions */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => {
              setShowCreate(true)
              setShowJoin(false)
            }}
            className="flex-1 bg-zinc-900 rounded-xl py-3 text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            + Create Group
          </button>
          <button
            onClick={() => {
              setShowJoin(true)
              setShowCreate(false)
            }}
            className="flex-1 bg-zinc-900 rounded-xl py-3 text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            Join Group
          </button>
        </div>

        {/* Create Group Form */}
        {showCreate && (
          <form onSubmit={handleCreateGroup} className="mb-6 bg-zinc-900 rounded-xl p-4">
            <h2 className="font-medium mb-3">Create New Group</h2>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              required
            />
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium"
              >
                Create
              </button>
            </div>
          </form>
        )}

        {/* Join Group Form */}
        {showJoin && (
          <form onSubmit={handleJoinGroup} className="mb-6 bg-zinc-900 rounded-xl p-4">
            <h2 className="font-medium mb-3">Join Group</h2>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Invite code"
              className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              required
            />
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowJoin(false)}
                className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium"
              >
                Join
              </button>
            </div>
          </form>
        )}

        {/* Groups List */}
        <h2 className="text-sm text-zinc-500 mb-3">Your Groups</h2>
        {isLoading ? (
          <div className="text-center py-8 text-zinc-500">Loading...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p>No groups yet</p>
            <p className="text-sm mt-1">Create or join a group to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => navigate(`/chat/${group.id}`)}
                className="w-full bg-zinc-900 rounded-xl p-4 text-left hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-xl">
                    🧠
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{group.name}</h3>
                    <p className="text-xs text-zinc-500">
                      Code: {group.invite_code}
                    </p>
                  </div>
                  <div className="text-zinc-500">→</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
