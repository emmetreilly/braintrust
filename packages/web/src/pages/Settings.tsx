import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { settings as settingsApi, groups as groupsApi, files as filesApi, OrgProfile } from '../lib/api'
import type { GroupMember, Group, DocumentTag } from '../types'

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
  const [channelDocs, setChannelDocs] = useState<{ id: string; filename: string; is_reference: boolean; file_size: number; tags?: DocumentTag[] }[]>([])
  const [togglingDoc, setTogglingDoc] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [workspaceUsers, setWorkspaceUsers] = useState<{ id: string; name: string; email: string }[]>([])
  const [invitingUser, setInvitingUser] = useState<string | null>(null)

  // Tags state
  const [tags, setTags] = useState<DocumentTag[]>([])
  const [showTagManager, setShowTagManager] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3b82f6')
  const [newTagType, setNewTagType] = useState<'deal' | 'client' | 'topic' | 'tag'>('deal')
  const [addingTag, setAddingTag] = useState(false)
  const [showTagSelector, setShowTagSelector] = useState<string | null>(null)

  // Workspace reference docs state
  const [workspaceDocs, setWorkspaceDocs] = useState<{ id: string; filename: string; file_size: number; created_at: string }[]>([])
  const [newDocFilename, setNewDocFilename] = useState('')
  const [newDocContent, setNewDocContent] = useState('')
  const [addingDoc, setAddingDoc] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [showChannelAddDoc, setShowChannelAddDoc] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const channelFileInputRef = useRef<HTMLInputElement>(null)

  // Org profiles state
  const [orgProfiles, setOrgProfiles] = useState<OrgProfile[]>([])
  const [uploadingOrg, setUploadingOrg] = useState(false)
  const orgCsvInputRef = useRef<HTMLInputElement>(null)

  const [isLoading, setIsLoading] = useState(true)
  const { user, workspace, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [groupId])

  const loadData = async () => {
    try {
      // Always load tags
      const tagsRes = await filesApi.listTags()
      setTags(tagsRes.tags)

      if (isChannelSettings) {
        // Load channel data
        const [groupRes, membersRes, docsRes] = await Promise.all([
          groupsApi.get(groupId!),
          groupsApi.members(groupId!),
          settingsApi.getChannelReferenceDocs(groupId!),
        ])
        setGroup(groupRes.group)
        setMembers(membersRes.members)
        setInviteCode(groupRes.group.invite_code)
        setChannelDocs(docsRes.documents)
      } else {
        // Load workspace data
        const [workspaceRes, docsRes, orgRes] = await Promise.all([
          settingsApi.getWorkspaceApiKey(),
          settingsApi.getWorkspaceReferenceDocs(),
          settingsApi.getOrgProfiles().catch(() => ({ profiles: [] })),
        ])
        setHasApiKey(workspaceRes.hasApiKey)
        setWorkspaceName(workspaceRes.workspace.name)
        setWorkspaceDocs(docsRes.documents)
        setOrgProfiles(orgRes.profiles)
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

  const openInviteModal = async () => {
    if (!groupId) return
    setShowInvite(true)
    try {
      const { users } = await groupsApi.workspaceUsers(groupId)
      // Filter out users who are already members
      const memberIds = members.map(m => m.user_id)
      setWorkspaceUsers(users.filter(u => !memberIds.includes(u.id)))
    } catch (err) {
      console.error('Failed to load workspace users:', err)
    }
  }

  const handleInviteUser = async (userId: string) => {
    if (!groupId) return
    setInvitingUser(userId)
    try {
      const result = await groupsApi.invite(groupId, userId)
      // Add to members list
      const invitedUser = workspaceUsers.find(u => u.id === userId)
      if (invitedUser && result.member) {
        setMembers(prev => [...prev, {
          user_id: result.member.user_id,
          group_id: groupId,
          role: result.member.role,
          joined_at: new Date().toISOString(),
          user: {
            id: result.member.user_id,
            email: result.member.email,
            name: result.member.name,
            interests: [],
            created_at: new Date().toISOString(),
          },
        }])
        // Remove from available users
        setWorkspaceUsers(prev => prev.filter(u => u.id !== userId))
      }
      setSuccess(`Invited ${invitedUser?.name || 'user'} to the channel`)
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError((err as Error).message)
      setTimeout(() => setError(''), 3000)
    } finally {
      setInvitingUser(null)
    }
  }

  const toggleReferenceDoc = async (docId: string) => {
    setTogglingDoc(docId)
    try {
      const res = await settingsApi.toggleChannelReferenceDoc(groupId!, docId)
      setChannelDocs(docs => docs.map(d =>
        d.id === docId ? { ...d, is_reference: res.isReference } : d
      ))
    } catch (err) {
      console.error('Failed to toggle reference doc:', err)
    } finally {
      setTogglingDoc(null)
    }
  }

  const uploadChannelDoc = async () => {
    if (!newDocFilename.trim() || !newDocContent.trim() || !groupId) return
    setAddingDoc(true)
    try {
      const res = await settingsApi.uploadChannelDoc(groupId, newDocFilename, newDocContent, true)
      setChannelDocs(docs => [res.document, ...docs])
      setNewDocFilename('')
      setNewDocContent('')
      setShowAddDoc(false)
      setSuccess('Document uploaded and pinned as reference!')
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload doc')
    } finally {
      setAddingDoc(false)
    }
  }

  const handleChannelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.py', '.yml', '.yaml']
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!allowedTypes.includes(ext)) {
      setError('Only text files are supported (.txt, .md, .json, .csv, etc.)')
      return
    }

    if (file.size > 500000) {
      setError('File too large. Maximum size is 500KB.')
      return
    }

    try {
      const content = await file.text()
      setNewDocFilename(file.name)
      setNewDocContent(content)
      setShowChannelAddDoc(true)
      setError('')
    } catch (err) {
      setError('Failed to read file')
    }

    if (channelFileInputRef.current) {
      channelFileInputRef.current.value = ''
    }
  }

  const addWorkspaceDoc = async () => {
    if (!newDocFilename.trim() || !newDocContent.trim()) return
    setAddingDoc(true)
    try {
      const res = await settingsApi.addWorkspaceReferenceDoc(newDocFilename, newDocContent)
      setWorkspaceDocs(docs => [...docs, res.document])
      setNewDocFilename('')
      setNewDocContent('')
      setShowAddDoc(false)
      setSuccess('Reference doc added! Brain will now use this across all channels.')
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add doc')
    } finally {
      setAddingDoc(false)
    }
  }

  const deleteWorkspaceDoc = async (id: string) => {
    if (!confirm('Delete this reference doc? Brain will no longer have access to it.')) return
    try {
      await settingsApi.deleteWorkspaceReferenceDoc(id)
      setWorkspaceDocs(docs => docs.filter(d => d.id !== id))
    } catch (err) {
      console.error('Failed to delete doc:', err)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Only allow text-based files
    const allowedTypes = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.py', '.yml', '.yaml']
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!allowedTypes.includes(ext)) {
      setError('Only text files are supported (.txt, .md, .json, .csv, etc.)')
      return
    }

    if (file.size > 500000) { // 500KB limit
      setError('File too large. Maximum size is 500KB.')
      return
    }

    try {
      const content = await file.text()
      setNewDocFilename(file.name)
      setNewDocContent(content)
      setShowAddDoc(true)
      setError('')
    } catch (err) {
      setError('Failed to read file')
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleOrgCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }

    if (file.size > 2000000) { // 2MB limit
      setError('File too large. Maximum size is 2MB.')
      return
    }

    setUploadingOrg(true)
    setError('')

    try {
      const content = await file.text()
      const res = await settingsApi.uploadOrgCSV(content, true) // Replace existing
      setOrgProfiles([]) // Clear to force reload
      // Reload org profiles
      const orgRes = await settingsApi.getOrgProfiles()
      setOrgProfiles(orgRes.profiles)
      setSuccess(`Loaded ${res.total} team members! Brain will now personalize responses.`)
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload CSV')
    } finally {
      setUploadingOrg(false)
      if (orgCsvInputRef.current) {
        orgCsvInputRef.current.value = ''
      }
    }
  }

  const createTag = async () => {
    if (!newTagName.trim()) return
    setAddingTag(true)
    try {
      const res = await filesApi.createTag(newTagName.trim(), newTagColor, newTagType)
      setTags(t => [...t, res.tag])
      setNewTagName('')
      setNewTagColor('#3b82f6')
      setNewTagType('deal')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag')
    } finally {
      setAddingTag(false)
    }
  }

  const addTagToDoc = async (docId: string, tagId: string) => {
    try {
      await filesApi.addTag(docId, tagId)
      const tag = tags.find(t => t.id === tagId)
      if (tag) {
        setChannelDocs(docs => docs.map(d =>
          d.id === docId
            ? { ...d, tags: [...(d.tags || []), tag] }
            : d
        ))
      }
      setShowTagSelector(null)
    } catch (err) {
      console.error('Failed to add tag:', err)
    }
  }

  const removeTagFromDoc = async (docId: string, tagId: string) => {
    try {
      await filesApi.removeTag(docId, tagId)
      setChannelDocs(docs => docs.map(d =>
        d.id === docId
          ? { ...d, tags: (d.tags || []).filter(t => t.id !== tagId) }
          : d
      ))
    } catch (err) {
      console.error('Failed to remove tag:', err)
    }
  }

  const TAG_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  ]

  // Channel Settings View
  if (isChannelSettings) {
    return (
      <>
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
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm text-zinc-500">Members ({members.length})</h2>
                <button
                  onClick={openInviteModal}
                  className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <span>+</span>
                  <span>Add Member</span>
                </button>
              </div>
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

              {/* Channel Reference Docs */}
              {/* Channel Documents */}
              <h2 className="text-sm text-zinc-500 mb-3 mt-6">Channel Documents</h2>

              {/* Hidden file input for channel */}
              <input
                ref={channelFileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.yml,.yaml"
                onChange={handleChannelFileUpload}
                className="hidden"
              />

              {success && (
                <div className="bg-green-500/10 text-green-500 text-sm rounded-lg p-3 mb-4 flex items-center gap-2">
                  <span>✓</span>
                  <span>{success}</span>
                </div>
              )}

              <div className="bg-zinc-900 rounded-xl p-4 mb-6">
                <p className="text-xs text-zinc-500 mb-3">
                  Upload documents for Brain to reference in this channel. Pinned docs are always loaded into context.
                </p>

                {/* Existing docs */}
                {channelDocs.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {channelDocs.map((doc) => (
                      <div key={doc.id} className="p-3 bg-zinc-800 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-lg">📄</span>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{doc.filename}</div>
                              <div className="text-xs text-zinc-500">
                                {(doc.file_size / 1024).toFixed(1)} KB
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => toggleReferenceDoc(doc.id)}
                            disabled={togglingDoc === doc.id}
                            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              doc.is_reference
                                ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                            }`}
                          >
                            {togglingDoc === doc.id ? '...' : doc.is_reference ? '📌 Pinned' : 'Pin'}
                          </button>
                        </div>
                        {/* Tags section */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {(doc.tags || []).map(tag => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                            >
                              {tag.name}
                              <button
                                onClick={() => removeTagFromDoc(doc.id, tag.id)}
                                className="hover:opacity-70 ml-0.5"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <div className="relative">
                            <button
                              onClick={() => setShowTagSelector(showTagSelector === doc.id ? null : doc.id)}
                              className="text-xs text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-700"
                            >
                              + tag
                            </button>
                            {showTagSelector === doc.id && (
                              <div className="absolute left-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-10 min-w-[160px] p-2">
                                {tags.length === 0 ? (
                                  <p className="text-xs text-zinc-500 p-2">No tags yet. Create one in workspace settings.</p>
                                ) : (
                                  <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {tags.filter(t => !(doc.tags || []).some(dt => dt.id === t.id)).map(tag => (
                                      <button
                                        key={tag.id}
                                        onClick={() => addTagToDoc(doc.id, tag.id)}
                                        className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-zinc-800 flex items-center gap-2"
                                      >
                                        <span
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: tag.color }}
                                        />
                                        <span>{tag.name}</span>
                                        <span className="text-zinc-600 text-[10px] ml-auto">{tag.tag_type}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload form */}
                {showChannelAddDoc ? (
                  <div className={channelDocs.length > 0 ? 'border-t border-zinc-800 pt-4' : ''}>
                    <input
                      type="text"
                      value={newDocFilename}
                      onChange={(e) => setNewDocFilename(e.target.value)}
                      placeholder="Filename (e.g., newell-transcript.txt)"
                      className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <textarea
                      value={newDocContent}
                      onChange={(e) => setNewDocContent(e.target.value)}
                      placeholder="Paste content here... (meeting notes, transcripts, SOWs, etc.)"
                      rows={6}
                      className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none font-mono"
                    />
                    {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowChannelAddDoc(false)
                          setNewDocFilename('')
                          setNewDocContent('')
                          setError('')
                        }}
                        className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm hover:bg-zinc-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={uploadChannelDoc}
                        disabled={addingDoc || !newDocFilename.trim() || !newDocContent.trim()}
                        className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                      >
                        {addingDoc ? 'Uploading...' : 'Upload & Pin'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => channelFileInputRef.current?.click()}
                      className="flex-1 bg-zinc-800 rounded-lg py-3 text-sm hover:bg-zinc-700 flex items-center justify-center gap-2"
                    >
                      <span>📎</span>
                      <span>Upload File</span>
                    </button>
                    <button
                      onClick={() => setShowChannelAddDoc(true)}
                      className="flex-1 bg-zinc-800 rounded-lg py-3 text-sm hover:bg-zinc-700 flex items-center justify-center gap-2"
                    >
                      <span>+</span>
                      <span>Paste Text</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Link to Workspace Settings */}
              <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                <p className="text-xs text-zinc-500 mb-2">
                  Company-wide Brain knowledge is configured at the workspace level.
                </p>
                <button
                  onClick={() => navigate('/settings')}
                  className="text-sm text-cyan-500 hover:underline"
                >
                  Go to Workspace Settings →
                </button>
              </div>

              {/* Danger Zone - Delete Channel (Admin only) */}
              {members.find(m => m.user_id === user?.id)?.role === 'admin' && (
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

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Add Members</h2>
              <button
                onClick={() => setShowInvite(false)}
                className="text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Invite Code Option */}
            <div className="mb-4 p-3 bg-zinc-800 rounded-lg">
              <p className="text-xs text-zinc-400 mb-2">Share invite code</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-lg tracking-widest text-center py-1">{inviteCode}</code>
                <button
                  onClick={copyInviteCode}
                  className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Or divider */}
            <div className="flex items-center gap-4 my-4">
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-xs text-zinc-500">or invite from workspace</span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>

            {/* Workspace users list */}
            {workspaceUsers.length === 0 ? (
              <p className="text-center text-zinc-500 py-4">
                All workspace members are already in this channel
              </p>
            ) : (
              <div className="space-y-2">
                {workspaceUsers.map((wsUser) => (
                  <div
                    key={wsUser.id}
                    className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg"
                  >
                    <div className="w-10 h-10 bg-zinc-700 rounded-full flex items-center justify-center text-sm font-medium">
                      {wsUser.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{wsUser.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{wsUser.email}</p>
                    </div>
                    <button
                      onClick={() => handleInviteUser(wsUser.id)}
                      disabled={invitingUser === wsUser.id}
                      className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 rounded-lg text-sm font-medium text-black"
                    >
                      {invitingUser === wsUser.id ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowInvite(false)}
              className="w-full mt-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg py-2.5 text-sm transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
      </>
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

        {/* Company Brain - Workspace Reference Docs */}
        <h2 className="text-sm text-zinc-500 mb-3 mt-6 flex items-center gap-2">
          <span>Company Brain</span>
          {workspaceDocs.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-500">
              {workspaceDocs.length} doc{workspaceDocs.length > 1 ? 's' : ''}
            </span>
          )}
        </h2>
        <p className="text-xs text-zinc-600 mb-4">
          Reference documents loaded into Brain for ALL channels. Add playbooks, deal rules, pricing guides, etc.
        </p>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.yml,.yaml"
          onChange={handleFileUpload}
          className="hidden"
        />

        <div className="bg-zinc-900 rounded-xl p-4">
          {workspaceDocs.length === 0 && !showAddDoc ? (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">📚</div>
              <p className="text-sm text-zinc-500 mb-3">No company knowledge docs yet</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-cyan-500 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-cyan-400"
                >
                  Upload File
                </button>
                <button
                  onClick={() => setShowAddDoc(true)}
                  className="bg-zinc-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-700"
                >
                  Paste Text
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Existing docs */}
              {workspaceDocs.length > 0 && (
                <div className="space-y-2 mb-4">
                  {workspaceDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-lg">📄</span>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{doc.filename}</div>
                          <div className="text-xs text-zinc-500">
                            {(doc.file_size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteWorkspaceDoc(doc.id)}
                        className="shrink-0 text-zinc-500 hover:text-red-400 px-2"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add doc form */}
              {showAddDoc ? (
                <div className="border-t border-zinc-800 pt-4">
                  <input
                    type="text"
                    value={newDocFilename}
                    onChange={(e) => setNewDocFilename(e.target.value)}
                    placeholder="Filename (e.g., KARTEL_BRAIN.md)"
                    className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <textarea
                    value={newDocContent}
                    onChange={(e) => setNewDocContent(e.target.value)}
                    placeholder="Paste content here... (deal rules, pricing, playbooks, etc.)"
                    rows={8}
                    className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none font-mono"
                  />
                  {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowAddDoc(false)
                        setNewDocFilename('')
                        setNewDocContent('')
                        setError('')
                      }}
                      className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addWorkspaceDoc}
                      disabled={addingDoc || !newDocFilename.trim() || !newDocContent.trim()}
                      className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                    >
                      {addingDoc ? 'Adding...' : 'Add Document'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 bg-zinc-800 rounded-lg py-3 text-sm hover:bg-zinc-700 flex items-center justify-center gap-2"
                  >
                    <span>📎</span>
                    <span>Upload File</span>
                  </button>
                  <button
                    onClick={() => setShowAddDoc(true)}
                    className="flex-1 bg-zinc-800 rounded-lg py-3 text-sm hover:bg-zinc-700 flex items-center justify-center gap-2"
                  >
                    <span>+</span>
                    <span>Paste Text</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Org Structure / Employee Data */}
        <h2 className="text-sm text-zinc-500 mb-3 mt-6 flex items-center gap-2">
          <span>Team Directory</span>
          {orgProfiles.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
              {orgProfiles.length} people
            </span>
          )}
        </h2>
        <p className="text-xs text-zinc-600 mb-4">
          Upload your employee CSV so Brain knows who's who. It will personalize responses based on each person's role.
        </p>

        <input
          ref={orgCsvInputRef}
          type="file"
          accept=".csv"
          onChange={handleOrgCsvUpload}
          className="hidden"
        />

        <div className="bg-zinc-900 rounded-xl p-4">
          {orgProfiles.length === 0 ? (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">👥</div>
              <p className="text-sm text-zinc-500 mb-3">No team data yet</p>
              <button
                onClick={() => orgCsvInputRef.current?.click()}
                disabled={uploadingOrg}
                className="bg-green-500 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-400 disabled:opacity-50"
              >
                {uploadingOrg ? 'Uploading...' : 'Upload Employee CSV'}
              </button>
              <p className="text-xs text-zinc-600 mt-2">
                CSV should have Name, Email, Title, Department columns
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-zinc-400">{orgProfiles.length} team members loaded</span>
                <button
                  onClick={() => orgCsvInputRef.current?.click()}
                  disabled={uploadingOrg}
                  className="text-xs text-green-400 hover:text-green-300"
                >
                  {uploadingOrg ? 'Uploading...' : 'Update CSV'}
                </button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {orgProfiles.slice(0, 10).map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-2 bg-zinc-800 rounded-lg text-sm">
                    <div className={`w-2 h-2 rounded-full ${p.userId ? 'bg-green-500' : 'bg-zinc-600'}`} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-zinc-500 truncate max-w-[100px]">{p.title || p.department || ''}</span>
                    {p.userId && (
                      <span className="text-[10px] text-green-500">linked</span>
                    )}
                  </div>
                ))}
                {orgProfiles.length > 10 && (
                  <p className="text-xs text-zinc-500 text-center py-1">
                    +{orgProfiles.length - 10} more
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Document Tags */}
        <h2 className="text-sm text-zinc-500 mb-3 mt-6 flex items-center gap-2">
          <span>Document Tags</span>
          {tags.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              {tags.length} tag{tags.length > 1 ? 's' : ''}
            </span>
          )}
        </h2>
        <p className="text-xs text-zinc-600 mb-4">
          Create tags to organize documents by deal, client, or topic. Tags can be applied in channel settings.
        </p>

        <div className="bg-zinc-900 rounded-xl p-4">
          {/* Existing tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <span className="text-[10px] opacity-60 ml-1">{tag.tag_type}</span>
                </span>
              ))}
            </div>
          )}

          {/* Create tag form */}
          {showTagManager ? (
            <div className={tags.length > 0 ? 'border-t border-zinc-800 pt-4' : ''}>
              <div className="space-y-3">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Tag name (e.g., Newell, Acme Corp, SOW)"
                  className="w-full bg-zinc-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <div className="flex gap-2">
                  <select
                    value={newTagType}
                    onChange={(e) => setNewTagType(e.target.value as 'deal' | 'client' | 'topic' | 'tag')}
                    className="flex-1 bg-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="deal">Deal</option>
                    <option value="client">Client</option>
                    <option value="topic">Topic</option>
                    <option value="tag">General</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setNewTagColor(color)}
                      className={`w-6 h-6 rounded-full transition-transform ${newTagColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                {error && <p className="text-red-500 text-xs">{error}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowTagManager(false)
                      setNewTagName('')
                      setError('')
                    }}
                    className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createTag}
                    disabled={addingTag || !newTagName.trim()}
                    className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {addingTag ? 'Creating...' : 'Create Tag'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowTagManager(true)}
              className={`w-full bg-zinc-800 rounded-lg py-3 text-sm hover:bg-zinc-700 flex items-center justify-center gap-2 ${tags.length > 0 ? 'border-t border-zinc-700 rounded-t-none' : ''}`}
            >
              <span>+</span>
              <span>Create New Tag</span>
            </button>
          )}
        </div>

        {/* How it works */}
        <div className="mt-6 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <h3 className="text-sm font-medium mb-2">How it works</h3>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• One API key powers all channels in your workspace</li>
            <li>• Keys are encrypted and stored securely</li>
            <li>• Company Brain docs are loaded in ALL channels</li>
            <li>• Channel-specific docs can be pinned in channel settings</li>
            <li>• Use tags to organize documents by deal or client</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
