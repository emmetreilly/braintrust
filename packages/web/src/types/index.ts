export interface User {
  id: string
  email: string
  name: string
  avatar_url?: string
  interests: string[]
  created_at: string
}

export interface Group {
  id: string
  name: string
  invite_code: string
  created_by: string
  preferred_provider?: 'claude' | 'openai' | 'gemini'
  created_at: string
}

export type AIProvider = 'claude' | 'openai' | 'gemini'

export interface GroupMember {
  user_id: string
  group_id: string
  joined_at: string
  user: User
}

export interface Message {
  id: string
  group_id: string
  user_id: string
  type: 'text' | 'brain_response' | 'media'
  content: string
  media_data?: string
  created_at: string
  author?: User
  reactions?: Reaction[]
}

export interface Reaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface PrivateThread {
  id: string
  user_id: string
  group_id: string
  context_message_id?: string
  context_text?: string
  created_at: string
}

export interface PrivateMessage {
  id: string
  thread_id: string
  role: 'user' | 'brain'
  content: string
  created_at: string
}

export interface MediaData {
  url: string
  type: 'link' | 'tweet' | 'video' | 'tiktok' | 'instagram' | 'spotify'
  title: string
  description?: string
  image?: string
  siteName: string
}

export interface WebSocketMessage {
  type: 'message' | 'presence' | 'reaction' | 'typing'
  message?: Message
  action?: 'joined' | 'left'
  userId?: string
  online?: string[]
  messageId?: string
  reaction?: Reaction
}
