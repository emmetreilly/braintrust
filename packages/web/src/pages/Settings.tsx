import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { settings as settingsApi, groups as groupsApi } from '../lib/api'
import type { GroupMember, Group } from '../types'

export default function Settings() {
  const { groupId } = useParams<{ groupId?: string }>()
  const isChannelSettings = !!groupId

  // Workspace settings state
  const [hasApiKey, setHasApiKey] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')

  // Channel settings state
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [inviteCode, setInviteCode] = useState('')
  const [copied, setCopied] = useState(false)

  const [isLoading, setIsLoading] = useState(true)
  const { user, workspace, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [groupId])

  const loadData = async () => {
    try {
      if (isChannelSettings) {
        // Load channel data
        const [groupRes, membersRes] = await Promise.all([
          groupsApi.get(groupId!),
          groupsApi.members(groupId!),
        ])
        setGroup(groupRes.group)
        setMembers(membersRes.members)
        setInviteCode(groupRes.group.invite_code)
      } else {
        // Load workspace data
        const workspaceRes = await settingsApi.getWorkspaceApiKey()
        setHasApiKey(workspaceRes.hasApiKey)
        setWorkspaceName(workspaceRes.workspace.name)
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveKey = async () => {
    if (!newKey.trim()) {
      setError('Please enter an API key')
      return
    }

    if (!newKey.startsWith('sk-ant-')) {
      setError('Invalid Claude API key format. Key should start with sk-ant-')
      return
    }

    setSaving(true)
    setError('')

    try {
      await settingsApi.setWorkspaceApiKey(newKey)
      setSuccess('API key saved successfully! Brain is now active for your workspace.')
      setNewKey('')
      setIsEditing(false)
      setHasApiKey(true)
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key')
    } finally {
      setSaving(false)
    }
  }

  const copyInviteCode = () => {
    navigator.clipboard.writeText(inviteCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Channel Settings View
  if (isChannelSettings) {
    return (
      <div className="min-h-screen bg-black text-white">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center justify-between max-w-md mx-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate(`/chat/${groupId}`)}
                className="text-zinc-400 hover:text-white"
              >
                ←
              </button>
              <h1 className="font-semibold">Channel Settings</h1>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto p-4">
          {isLoading ? (
            <div className="text-center py-8 text-zinc-500">Loading...</div>
          ) : (
            <>
              {/* Channel Info */}
              <div className="bg-zinc-900 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400 text-xl">
                    #
                  </div>
                  <div>
                    <div className="font-medium">{group?.name?.toLowerCase().replace(/\s+/g, '-')}</div>
                    <div className="text-xs text-zinc-500">{members.length} members</div>
                  </div>
                </div>
              </div>

              {/* Invite Code */}
              <h2 className="text-sm text-zinc-500 mb-3">Invite Code</h2>
              <div className="bg-zinc-900 rounded-xl p-4 mb-6">
                <p className="text-xs text-zinc-500 mb-3">Share this code to invite people to the channel</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-zinc-800 rounded-lg px-4 py-3 font-mono text-lg tracking-widest text-center">
                    {inviteCode}
                  </div>
                  <button
                    onClick={copyInviteCode}
                    className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-3 text-sm transition-colors"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Members */}
              <h2 className="text-sm text-zinc-500 mb-3">Members</h2>
              <div className="bg-zinc-900 rounded-xl divide-y divide-zinc-800">
                {members.map((member) => (
                  <div key={member.user_id} className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-zinc-700 rounded-full flex items-center justify-center text-sm font-medium">
                      {member.user?.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{member.user?.name}</div>
                      <div className="text-xs text-zinc-500">{member.user?.email}</div>
                    </div>
                    {member.user_id === group?.created_by && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-500">
                        Admin
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Link to Workspace Settings */}
              <div className="mt-6 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                <p className="text-xs text-zinc-500 mb-2">
                  Brain AI is configured at the workspace level.
                </p>
                <button
                  onClick={() => navigate('/settings')}
                  className="text-sm text-cyan-500 hover:underline"
                >
                  Go to Workspace Settings →
                </button>
              </div>

              {/* Danger Zone - Delete Channel (Admin only) */}
              {group?.created_by === user?.id && (
                <div className="mt-6">
                  <h2 className="text-sm text-red-500 mb-3">Danger Zone</h2>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <p className="text-sm text-zinc-300 mb-3">
                      Deleting this channel will permanently remove all messages and data. This action cannot be undone.
                    </p>
                    <button
                      onClick={async () => {
                        if (confirm(`Are you sure you want to delete #${group!.name.toLowerCase().replace(/\s+/g, '-')}? This cannot be undone.`)) {
                          try {
                            await groupsApi.delete(groupId!)
                            navigate('/groups')
                          } catch (err) {
                            alert(err instanceof Error ? err.message : 'Failed to delete channel')
                          }
                        }
                      }}
                      className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                    >
                      Delete Channel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // Workspace Settings View
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/groups')}
              className="text-zinc-400 hover:text-white"
            >
              ←
            </button>
            <h1 className="font-semibold">Workspace Settings</h1>
          </div>
          <button
            onClick={logout}
            className="text-sm text-zinc-500 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4">
        {/* User Info */}
        <div className="bg-zinc-900 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-xl">
              {user?.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1">
              <div className="font-medium">{user?.name}</div>
              <div className="text-sm text-zinc-500">{user?.email}</div>
            </div>
          </div>
        </div>

        {/* Workspace Section */}
        <div className="bg-zinc-900 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center font-bold">
              {workspaceName?.charAt(0) || workspace?.name?.charAt(0) || 'W'}
            </div>
            <div>
              <div className="font-medium">{workspaceName || workspace?.name || 'Workspace'}</div>
              <div className="text-xs text-zinc-500">
                {workspace?.domain || user?.email?.split('@')[1]}
              </div>
            </div>
          </div>
        </div>

        {/* Workspace API Key */}
        <h2 className="text-sm text-zinc-500 mb-3 flex items-center gap-2">
          <span>Brain AI</span>
          {hasApiKey && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">
              Active
            </span>
          )}
        </h2>
        <p className="text-xs text-zinc-600 mb-4">
          One API key powers @brain across all channels in{' '}
          <span className="text-zinc-400">{workspaceName || workspace?.name}</span>.
        </p>

        {success && (
          <div className="bg-green-500/10 text-green-500 text-sm rounded-lg p-3 mb-4 flex items-center gap-2">
            <span>✓</span>
            <span>{success}</span>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-zinc-500">Loading...</div>
        ) : (
          <div className="bg-zinc-900 rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-medium flex items-center gap-2">
                  Claude API Key
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {hasApiKey
                    ? 'Brain is active and can answer questions, summarize, search memory, and more.'
                    : 'Add your key to enable Brain features across all channels.'}
                </p>
              </div>
            </div>

            {hasApiKey && !isEditing && (
              <div className="mt-3 flex items-center gap-2 bg-zinc-800 rounded-lg px-4 py-3">
                <div className="flex-1">
                  <div className="font-mono text-sm text-zinc-400">sk-ant-•••••••••••••••</div>
                  <div className="text-xs text-green-500 mt-1">Key saved and active</div>
                </div>
              </div>
            )}

            {isEditing ? (
              <div className="mt-3">
                <input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                  autoFocus
                />
                {error && (
                  <p className="text-red-500 text-xs mb-2">{error}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsEditing(false)
                      setNewKey('')
                      setError('')
                    }}
                    className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveKey}
                    disabled={saving}
                    className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan-500 mt-2 block hover:underline"
                >
                  Get an API key from Anthropic →
                </a>
              </div>
            ) : (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setIsEditing(true)
                    setError('')
                  }}
                  className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm hover:bg-zinc-700"
                >
                  {hasApiKey ? 'Replace Key' : 'Add Key'}
                </button>
                {hasApiKey && (
                  <button
                    onClick={async () => {
                      if (confirm('Remove API key? Brain will stop working in all channels.')) {
                        try {
                          await settingsApi.deleteWorkspaceApiKey()
                          setHasApiKey(false)
                          setSuccess('API key removed')
                          setTimeout(() => setSuccess(''), 3000)
                        } catch (err) {
                          setError('Failed to remove key')
                        }
                      }
                    }}
                    className="bg-red-500/10 text-red-500 rounded-lg px-4 py-2 text-sm hover:bg-red-500/20"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="mt-6 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <h3 className="text-sm font-medium mb-2">How it works</h3>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• One API key powers all channels in your workspace</li>
            <li>• Keys are encrypted and stored securely</li>
            <li>• Usage is billed to your Anthropic account</li>
            <li>• @brain in any channel will use this key</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
