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
  is_reference?: boolean
  created_at: string
  tags?: DocumentTag[]
  uploader?: { id: string; name: string; email: string }
}

export interface DocumentTag {
  id: string
  workspace_id: string
  name: string
  color: string
  tag_type: 'deal' | 'client' | 'topic' | 'tag'
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
  role: string
  joined_at: string
  user: User
}

export interface Message {
  id: string
  group_id: string
  user_id: string
  type: 'text' | 'brain_response' | 'media' | 'brain_insight' | 'system'
  content: string
  media_data?: string
  visible_to?: string // If set, only visible to this user until shared
  parent_message_id?: string // For threaded replies
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
  type: 'message' | 'presence' | 'reaction' | 'typing' | 'member_added'
  message?: Message
  action?: 'joined' | 'left'
  userId?: string
  online?: string[]
  messageId?: string
  reaction?: Reaction
  // member_added event fields
  groupId?: string
  groupName?: string
  member?: {
    user_id: string
    name: string
    email: string
    role: string
  }
  addedBy?: {
    id: string
    name: string
  }
  systemMessage?: Message
}

export interface ClaudeDocument {
  id: string
  group_id: string
  created_by: string
  creator_name?: string
  title: string
  conversation_history?: ConversationMessage[]
  is_shared: boolean
  shared_at?: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  userId?: string
}
