export interface Env {
  DB: D1Database
  R2_BUCKET: R2Bucket
  CHAT_ROOMS: DurableObjectNamespace
  JWT_SECRET: string
  ENVIRONMENT: string
}

export interface User {
  id: string
  email: string
  name: string
  avatar_url?: string
  interests: string[]
  created_at: string
}

export interface UserApiKey {
  id: string
  user_id: string
  provider: 'claude' | 'openai' | 'gemini'
  encrypted_key: string
  is_valid: boolean
  created_at: string
  updated_at: string
}

export interface Group {
  id: string
  name: string
  invite_code: string
  created_by: string
  preferred_provider: 'claude' | 'openai' | 'gemini'
  created_at: string
}

export interface GroupMember {
  group_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
}

export interface Message {
  id: string
  group_id: string
  user_id: string
  type: 'text' | 'brain_response' | 'media'
  content: string
  media_data?: string
  ai_provider?: string
  created_at: string
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
  ai_provider?: string
  created_at: string
}

export interface JWTPayload {
  sub: string
  email: string
  name: string
  iat: number
  exp: number
}

export type AIProvider = 'claude' | 'openai' | 'gemini'
