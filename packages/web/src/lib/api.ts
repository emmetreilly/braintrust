const API_BASE = '/api'

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
    fetchApi<{ user: import('../types').User; token: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    fetchApi<{ user: import('../types').User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => fetchApi<{ user: import('../types').User }>('/auth/me'),
}

// Groups
export const groups = {
  list: () => fetchApi<{ groups: import('../types').Group[] }>('/groups'),

  create: (name: string) =>
    fetchApi<{ group: import('../types').Group }>('/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  get: (id: string) => fetchApi<{ group: import('../types').Group }>(`/groups/${id}`),

  join: (code: string) =>
    fetchApi<{ group: import('../types').Group }>(`/groups/join/${code}`, {
      method: 'POST',
    }),

  members: (id: string) =>
    fetchApi<{ members: import('../types').GroupMember[] }>(`/groups/${id}/members`),
}

// Messages
export const messages = {
  list: (groupId: string, cursor?: string) =>
    fetchApi<{ messages: import('../types').Message[]; nextCursor?: string }>(
      `/groups/${groupId}/messages${cursor ? `?cursor=${cursor}` : ''}`
    ),

  send: (groupId: string, content: string, type: string = 'text') =>
    fetchApi<{ message: import('../types').Message }>(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, type }),
    }),

  react: (messageId: string, emoji: string) =>
    fetchApi<{ reaction: import('../types').Reaction }>(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
}

// Brain
export const brain = {
  respond: (groupId: string, messageId: string, content: string) =>
    fetchApi<{ message: import('../types').Message }>('/brain/respond', {
      method: 'POST',
      body: JSON.stringify({ groupId, messageId, content }),
    }),

  private: (groupId: string, message: string, context?: string, history?: { role: string; content: string }[]) =>
    fetchApi<{ response: string }>('/brain/private', {
      method: 'POST',
      body: JSON.stringify({ groupId, message, context, history }),
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
