-- Add visible_to column for private-first Brain responses
-- When null, visible to everyone. When set to a user_id, only that user can see it until shared.
ALTER TABLE messages ADD COLUMN visible_to TEXT;

-- Index for filtering private messages
CREATE INDEX IF NOT EXISTS idx_messages_visible_to ON messages(visible_to);
