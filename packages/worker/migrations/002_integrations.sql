-- Migration: Add integrations and indexed items for workspace knowledge layer

-- Connected integrations per workspace (Slack, Google Drive, Gmail, Hubspot)
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,  -- 'slack', 'google_drive', 'gmail', 'hubspot'
  status TEXT DEFAULT 'active',  -- 'active', 'syncing', 'error', 'disconnected'

  -- OAuth tokens (encrypted)
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at DATETIME,

  -- Sync state
  last_sync_at DATETIME,
  sync_cursor TEXT,  -- Provider-specific cursor for incremental sync
  items_indexed INTEGER DEFAULT 0,

  -- Provider-specific config
  config TEXT,  -- JSON: e.g., { "channels": ["C123"], "team_id": "T123" }

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, provider)
);

-- Indexed items from all sources
CREATE TABLE IF NOT EXISTS indexed_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,

  -- Source identification
  source TEXT NOT NULL,  -- 'slack', 'google_drive', 'gmail', 'hubspot'
  source_id TEXT NOT NULL,  -- Original ID in source system
  source_url TEXT,  -- Deep link back to source

  -- Content
  title TEXT,
  content TEXT NOT NULL,
  content_type TEXT,  -- 'message', 'file', 'email', 'deal', 'comment'

  -- Collaboration context (the differentiator!)
  author_id TEXT,
  author_name TEXT,
  author_email TEXT,

  -- Temporal context
  created_at DATETIME NOT NULL,
  updated_at DATETIME,

  -- Organizational context
  channel_id TEXT,  -- Slack channel, Drive folder, Gmail label
  channel_name TEXT,
  thread_id TEXT,  -- Thread/conversation grouping
  parent_id TEXT,  -- For replies, comments

  -- Engagement signals
  reactions TEXT,  -- JSON: [{"emoji": "👍", "count": 3, "users": [...]}]
  mentions TEXT,  -- JSON: ["user_id_1", "user_id_2"]
  reply_count INTEGER DEFAULT 0,

  -- File metadata (if applicable)
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  r2_key TEXT,  -- Cached file in R2

  -- Search
  has_embedding INTEGER DEFAULT 0,
  embedding_updated_at DATETIME,

  -- Indexing
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, source, source_id)
);

-- Aggregated stats for people (for "who's the lead" queries)
CREATE TABLE IF NOT EXISTS people_stats (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,

  -- Identity (may span multiple sources)
  email TEXT,
  name TEXT,
  slack_user_id TEXT,

  -- Activity stats (updated periodically)
  total_messages INTEGER DEFAULT 0,
  total_files_shared INTEGER DEFAULT 0,
  total_reactions_received INTEGER DEFAULT 0,
  channels_active TEXT,  -- JSON: ["channel_id_1", "channel_id_2"]

  last_active_at DATETIME,
  stats_updated_at DATETIME,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, email)
);

-- Search/query history for suggestions
CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  query TEXT NOT NULL,
  results_count INTEGER,
  clicked_result_id TEXT,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_integrations_workspace ON integrations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_indexed_items_workspace ON indexed_items(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_indexed_items_source ON indexed_items(workspace_id, source);
CREATE INDEX IF NOT EXISTS idx_indexed_items_author ON indexed_items(workspace_id, author_email);
CREATE INDEX IF NOT EXISTS idx_indexed_items_channel ON indexed_items(workspace_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_indexed_items_content_type ON indexed_items(workspace_id, content_type);
CREATE INDEX IF NOT EXISTS idx_indexed_items_embedding ON indexed_items(workspace_id, has_embedding);
CREATE INDEX IF NOT EXISTS idx_people_stats_workspace ON people_stats(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_query_history_workspace ON query_history(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_history_user ON query_history(user_id, created_at DESC);
