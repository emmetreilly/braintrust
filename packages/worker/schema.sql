-- Brain Trust Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  interests TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User API keys (encrypted, stored per-user)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'claude', 'openai', 'gemini'
  encrypted_key TEXT NOT NULL,
  is_valid INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, provider)
);

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  preferred_provider TEXT DEFAULT 'claude', -- Default AI provider for the group
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Group members junction table
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member', -- 'admin', 'member'
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- 'text', 'brain_response', 'media'
  content TEXT NOT NULL,
  media_data TEXT, -- JSON for unfurled link data
  ai_provider TEXT, -- Which AI generated this (if brain_response)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Reactions table
CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(message_id, user_id, emoji)
);

-- Private threads table
CREATE TABLE IF NOT EXISTS private_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  context_message_id TEXT,
  context_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Private messages table
CREATE TABLE IF NOT EXISTS private_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user', 'brain'
  content TEXT NOT NULL,
  ai_provider TEXT, -- Which AI generated this (if brain)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES private_threads(id) ON DELETE CASCADE
);

-- Taste profiles table (for learning engine)
CREATE TABLE IF NOT EXISTS taste_profiles (
  group_id TEXT PRIMARY KEY,
  topics TEXT DEFAULT '{}', -- JSON of topic frequencies
  engagement_data TEXT DEFAULT '{}', -- JSON of what gets reactions
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Message embeddings tracking (actual vectors stored in Vectorize)
CREATE TABLE IF NOT EXISTS message_embeddings (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'cloudflare' or 'openai'
  dimensions INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Media content analysis (articles, videos, etc.)
CREATE TABLE IF NOT EXISTS media_content (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL, -- 'article', 'video', 'pdf', 'image', 'tweet'
  title TEXT,
  content TEXT, -- Full extracted text
  summary TEXT, -- AI-generated summary
  has_embedding INTEGER DEFAULT 0, -- Whether stored in Vectorize
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Conversation summaries (daily, weekly, topic-based)
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'daily', 'weekly', 'topic', 'on_demand'
  period_start DATETIME,
  period_end DATETIME,
  topic TEXT, -- For topic-based summaries
  summary TEXT NOT NULL,
  key_topics TEXT DEFAULT '[]', -- JSON array of extracted topics
  message_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- LoRA training jobs
CREATE TABLE IF NOT EXISTS training_jobs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  provider TEXT NOT NULL, -- 'together', 'openai'
  model_id TEXT, -- Resulting fine-tuned model ID
  training_file_id TEXT, -- File ID from provider
  message_count INTEGER DEFAULT 0,
  error TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Group AI settings (LoRA model, preferred providers, etc.)
CREATE TABLE IF NOT EXISTS group_ai_settings (
  group_id TEXT PRIMARY KEY,
  lora_model_id TEXT, -- Currently active fine-tuned model
  lora_provider TEXT, -- 'together' or 'openai'
  use_rag INTEGER DEFAULT 1, -- Whether to use RAG for responses
  embedding_provider TEXT DEFAULT 'cloudflare', -- 'cloudflare' or 'openai'
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Fact check results
CREATE TABLE IF NOT EXISTS fact_checks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message_id TEXT, -- Original message that was fact-checked
  claim TEXT NOT NULL, -- The claim being checked
  verdict TEXT NOT NULL, -- 'true', 'false', 'partially_true', 'unverifiable'
  explanation TEXT NOT NULL,
  sources TEXT DEFAULT '[]', -- JSON array of source URLs
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Recommendations (proactive content suggestions)
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'news', 'article', 'paper', 'video'
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL, -- 'hackernews', 'arxiv', 'newsapi', etc.
  relevance_score REAL DEFAULT 0,
  reason TEXT, -- Why this was recommended
  status TEXT DEFAULT 'pending', -- 'pending', 'posted', 'dismissed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_private_messages_thread ON private_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_message_embeddings_group ON message_embeddings(group_id);
CREATE INDEX IF NOT EXISTS idx_media_content_group ON media_content(group_id);
CREATE INDEX IF NOT EXISTS idx_media_content_message ON media_content(message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_group ON conversation_summaries(group_id, type);
CREATE INDEX IF NOT EXISTS idx_training_jobs_group ON training_jobs(group_id, status);
CREATE INDEX IF NOT EXISTS idx_fact_checks_group ON fact_checks(group_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_group ON recommendations(group_id, status);
