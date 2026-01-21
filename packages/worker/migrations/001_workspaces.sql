-- Migration: Add workspace-based architecture with document management

-- Workspaces (auto-created from email domain)
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,  -- e.g., 'kartel.com'
  name TEXT NOT NULL,           -- e.g., 'Kartel'
  claude_api_key_encrypted TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add workspace_id to users
ALTER TABLE users ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

-- Create index for workspace lookup by domain
CREATE INDEX IF NOT EXISTS idx_workspaces_domain ON workspaces(domain);
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);

-- Documents table (uploaded files)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,        -- 'pdf', 'doc', 'image', 'spreadsheet', etc.
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,     -- bytes
  r2_key TEXT NOT NULL,           -- R2 object key
  content_text TEXT,              -- Extracted text content for search
  has_embedding INTEGER DEFAULT 0, -- Whether indexed in Vectorize
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Document tags (for deals, clients, topics)
CREATE TABLE IF NOT EXISTS document_tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',   -- Hex color for UI
  tag_type TEXT DEFAULT 'tag',    -- 'deal', 'client', 'topic', 'tag'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, name)
);

-- Junction table for document-tag relationships
CREATE TABLE IF NOT EXISTS document_tag_assignments (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES document_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);

-- Document shares (when docs are shared in chat)
CREATE TABLE IF NOT EXISTS document_shares (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  shared_by TEXT NOT NULL,
  note TEXT,                      -- Optional note when sharing
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_by) REFERENCES users(id)
);

-- Indexes for document queries
CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_uploader ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(workspace_id, file_type);
CREATE INDEX IF NOT EXISTS idx_document_tags_workspace ON document_tags(workspace_id);
CREATE INDEX IF NOT EXISTS idx_document_tag_assignments_doc ON document_tag_assignments(document_id);
CREATE INDEX IF NOT EXISTS idx_document_tag_assignments_tag ON document_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_doc ON document_shares(document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_message ON document_shares(message_id);
