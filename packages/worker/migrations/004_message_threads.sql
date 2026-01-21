-- Migration 004: Add parent_message_id for threaded replies
-- This enables public follow-up questions on shared Brain insights

ALTER TABLE messages ADD COLUMN parent_message_id TEXT REFERENCES messages(id);

-- Index for efficient thread lookups
CREATE INDEX IF NOT EXISTS idx_messages_parent_message_id ON messages(parent_message_id);
