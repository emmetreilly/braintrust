export interface Env {
  DB: D1Database
  R2_BUCKET: R2Bucket
  CHAT_ROOMS: DurableObjectNamespace
  JWT_SECRET: string
  ENVIRONMENT: string
  VECTORIZE: VectorizeIndex
  AI: Ai
  // Google OAuth
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  WORKER_URL: string
  WEB_URL: string
}

export interface User {
  id: string
  email: string
  name: string
  avatar_url?: string
  interests: string[]
  created_at: string
  workspace_id?: string
  workspace_name?: string
}

export interface Workspace {
  id: string
  domain: string
  name: string
  claude_api_key_encrypted?: string
  created_at: string
}

export interface Document {
  id: string
  workspace_id: string
  uploaded_by: string
  filename: string
  file_type: string
  mime_type: string
  file_size: number
  r2_key: string
  content_text?: string
  has_embedding: boolean
  created_at: string
  tags?: DocumentTag[]
  uploader?: User
}

export interface DocumentTag {
  id: string
  workspace_id: string
  name: string
  color: string
  tag_type: 'deal' | 'client' | 'topic' | 'tag'
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
  type: 'text' | 'brain_response' | 'media' | 'brain_insight'
  content: string
  media_data?: string
  ai_provider?: string
  visible_to?: string // If set, only visible to this user until shared
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
