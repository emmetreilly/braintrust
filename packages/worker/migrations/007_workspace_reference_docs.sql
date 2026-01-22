-- Migration 007: Workspace-level reference documents
-- These docs are loaded into Brain context for ALL channels in the workspace
-- Use for company playbooks, deal rules, pricing guides, etc.

CREATE TABLE IF NOT EXISTS workspace_reference_docs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_text TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Index for efficient lookup by workspace
CREATE INDEX IF NOT EXISTS idx_workspace_reference_docs_workspace ON workspace_reference_docs(workspace_id);
