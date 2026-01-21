// In production (Pages), use the worker URL. In dev, use proxy.
const API_BASE = import.meta.env.VITE_API_URL ||
  (window.location.hostname.includes('pages.dev') || window.location.hostname.includes('brain-trust')
    ? 'https://brain-trust-worker.e-caa.workers.dev/api'
    : '/api')

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const token = localStorage.getItem('token')

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || 'Request failed')
  }

  return response.json()
}

// Auth
export const auth = {
  signup: (email: string, password: string, name: string) =>
    fetchApi<{ user: import('../types').User; token: string; workspace: import('../types').Workspace | null }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    fetchApi<{ user: import('../types').User; token: string; workspace: import('../types').Workspace | null }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => fetchApi<{ user: import('../types').User; workspace: import('../types').Workspace | null }>('/auth/me'),
}

// Groups
export const groups = {
  list: () => fetchApi<{ groups: import('../types').Group[] }>('/groups'),

  create: (name: string, description?: string) =>
    fetchApi<{ group: import('../types').Group }>('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  get: (id: string) => fetchApi<{ group: import('../types').Group }>(`/groups/${id}`),

  join: (code: string) =>
    fetchApi<{ group: import('../types').Group }>(`/groups/join/${code}`, {
      method: 'POST',
    }),

  members: (id: string) =>
    fetchApi<{ members: import('../types').GroupMember[] }>(`/groups/${id}/members`),

  setApiKey: (id: string, apiKey: string) =>
    fetchApi<{ success: boolean }>(`/groups/${id}/api-key`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  getApiKeyStatus: (id: string) =>
    fetchApi<{ hasApiKey: boolean }>(`/groups/${id}/api-key/status`),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/groups/${id}`, {
      method: 'DELETE',
    }),
}

// Messages
export const messages = {
  list: (groupId: string, cursor?: string) =>
    fetchApi<{ messages: import('../types').Message[]; nextCursor?: string }>(
      `/groups/${groupId}/messages${cursor ? `?cursor=${cursor}` : ''}`
    ),

  send: (groupId: string, content: string, type: string = 'text', media_data?: string) =>
    fetchApi<{ message: import('../types').Message }>(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, type, media_data }),
    }),

  react: (messageId: string, emoji: string) =>
    fetchApi<{ reaction: import('../types').Reaction }>(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  delete: (messageId: string) =>
    fetchApi<{ success: boolean; deleted_at: string }>(`/messages/${messageId}`, {
      method: 'DELETE',
    }),
}

// Brain
export const brain = {
  respond: (groupId: string, messageId: string, content: string) =>
    fetchApi<{ message: import('../types').Message }>('/brain/respond', {
      method: 'POST',
      body: JSON.stringify({ groupId, messageId, content }),
    }),

  private: (groupId: string, message: string, context?: string, history?: { role: string; content: string }[], documentId?: string) =>
    fetchApi<{ response: string }>('/brain/private', {
      method: 'POST',
      body: JSON.stringify({ groupId, message, context, history, documentId }),
    }),

  factCheck: (groupId: string, content: string) =>
    fetchApi<{ response: string; results?: any[] }>('/brain/fact-check', {
      method: 'POST',
      body: JSON.stringify({ groupId, content }),
    }),

  summarize: (groupId: string, type: 'daily' | 'weekly' | 'topic' | 'catchup', topic?: string) =>
    fetchApi<{ response: string }>('/brain/summarize', {
      method: 'POST',
      body: JSON.stringify({ groupId, type, topic }),
    }),

  analyzeMedia: (groupId: string, url: string) =>
    fetchApi<{ response: string }>('/brain/analyze-media', {
      method: 'POST',
      body: JSON.stringify({ groupId, url }),
    }),

  recommend: (groupId: string, limit?: number) =>
    fetchApi<{ response: string; recommendations?: any[] }>('/brain/recommend', {
      method: 'POST',
      body: JSON.stringify({ groupId, limit }),
    }),

  searchMemory: (groupId: string, query: string, limit?: number) =>
    fetchApi<{ response: string; results?: any[] }>('/brain/search-memory', {
      method: 'POST',
      body: JSON.stringify({ groupId, query, limit }),
    }),

  shareMessage: (messageId: string) =>
    fetchApi<{ success: boolean; message: import('../types').Message }>(`/brain/share/${messageId}`, {
      method: 'POST',
    }),

  followup: (groupId: string, parentMessageId: string, question: string) =>
    fetchApi<{ questionMessage: import('../types').Message; responseMessage: import('../types').Message }>('/brain/followup', {
      method: 'POST',
      body: JSON.stringify({ groupId, parentMessageId, question }),
    }),
}

// Media
export const media = {
  unfurl: (url: string) =>
    fetchApi<import('../types').MediaData>('/media/unfurl', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
}

// Documents
export const documents = {
  list: (groupId: string, sharedOnly = false) =>
    fetchApi<{ documents: import('../types').ClaudeDocument[] }>(
      `/brain/documents?groupId=${groupId}${sharedOnly ? '&sharedOnly=true' : ''}`
    ),

  get: (id: string) =>
    fetchApi<{ document: import('../types').ClaudeDocument }>(`/brain/documents/${id}`),

  create: (groupId: string, title: string, initialPrompt: string) =>
    fetchApi<{ document: import('../types').ClaudeDocument }>('/brain/documents', {
      method: 'POST',
      body: JSON.stringify({ groupId, title, initialPrompt }),
    }),

  continue: (id: string, message: string) =>
    fetchApi<{ response: string; conversation_history: import('../types').ConversationMessage[] }>(
      `/brain/documents/${id}/continue`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      }
    ),

  share: (id: string, shareMessage?: string) =>
    fetchApi<{ success: boolean; message: import('../types').Message }>(
      `/brain/documents/${id}/share`,
      {
        method: 'POST',
        body: JSON.stringify({ shareMessage }),
      }
    ),
}

// Files (workspace documents)
export const files = {
  list: (params?: { tag?: string; type?: string; search?: string }) => {
    const queryParams = new URLSearchParams()
    if (params?.tag) queryParams.set('tag', params.tag)
    if (params?.type) queryParams.set('type', params.type)
    if (params?.search) queryParams.set('search', params.search)
    const query = queryParams.toString()
    return fetchApi<{ documents: import('../types').Document[] }>(
      `/documents${query ? `?${query}` : ''}`
    )
  },

  // Get documents shared to a specific channel/group
  listByGroup: (groupId: string) =>
    fetchApi<{ documents: import('../types').Document[] }>(`/documents/group/${groupId}`),

  upload: async (file: File) => {
    const token = localStorage.getItem('token')
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }))
      throw new Error(error.message || 'Upload failed')
    }

    return response.json() as Promise<{ document: import('../types').Document }>
  },

  download: (id: string) => `${API_BASE}/documents/${id}/download`,

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/documents/${id}`, {
      method: 'DELETE',
    }),

  search: (query: string, limit = 10) =>
    fetchApi<{ documents: import('../types').Document[]; query: string }>('/documents/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    }),

  // Share file to group with optional summarization
  shareToGroup: (documentId: string, groupId: string, summarize = true) =>
    fetchApi<{ message: import('../types').Message; summary?: string }>('/documents/share-to-group', {
      method: 'POST',
      body: JSON.stringify({ documentId, groupId, summarize }),
    }),

  // Tags
  listTags: () =>
    fetchApi<{ tags: import('../types').DocumentTag[] }>('/documents/tags'),

  createTag: (name: string, color?: string, tag_type?: 'deal' | 'client' | 'topic' | 'tag') =>
    fetchApi<{ tag: import('../types').DocumentTag }>('/documents/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color, tag_type }),
    }),

  addTag: (documentId: string, tagId: string) =>
    fetchApi<{ success: boolean }>(`/documents/${documentId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag_id: tagId }),
    }),

  removeTag: (documentId: string, tagId: string) =>
    fetchApi<{ success: boolean }>(`/documents/${documentId}/tags/${tagId}`, {
      method: 'DELETE',
    }),

  setReference: (documentId: string, groupId: string, isReference: boolean) =>
    fetchApi<{ success: boolean; is_reference: boolean }>(`/documents/${documentId}/reference`, {
      method: 'PUT',
      body: JSON.stringify({ is_reference: isReference, group_id: groupId }),
    }),
}

// Settings
export const settings = {
  getWorkspaceApiKey: () =>
    fetchApi<{ workspace: { id: string; name: string; domain: string }; hasApiKey: boolean }>(
      '/settings/workspace/api-key'
    ),

  setWorkspaceApiKey: (apiKey: string) =>
    fetchApi<{ success: boolean }>('/settings/workspace/api-key', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }),

  deleteWorkspaceApiKey: () =>
    fetchApi<{ success: boolean }>('/settings/workspace/api-key', {
      method: 'DELETE',
    }),
}

// Combined API object for convenience
export const api = {
  auth,
  groups,
  messages,
  brain,
  media,
  documents,
  files,
  settings,
}
