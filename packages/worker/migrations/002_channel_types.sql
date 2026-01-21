-- Migration: Add channel types and workspace relationship to groups

-- Add channel_type to groups (team, deal, dm)
ALTER TABLE groups ADD COLUMN channel_type TEXT DEFAULT 'team';

-- Add workspace_id to groups (channels belong to workspaces)
ALTER TABLE groups ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

-- Add external_id for CRM integration (HubSpot deal ID, etc.)
ALTER TABLE groups ADD COLUMN external_id TEXT;
ALTER TABLE groups ADD COLUMN external_source TEXT; -- 'hubspot', 'salesforce', etc.

-- Add deleted_at for soft delete on messages
ALTER TABLE messages ADD COLUMN deleted_at DATETIME;
ALTER TABLE messages ADD COLUMN deleted_by TEXT REFERENCES users(id);

-- Index for workspace channels
CREATE INDEX IF NOT EXISTS idx_groups_workspace ON groups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_groups_channel_type ON groups(workspace_id, channel_type);
CREATE INDEX IF NOT EXISTS idx_groups_external ON groups(external_source, external_id);
