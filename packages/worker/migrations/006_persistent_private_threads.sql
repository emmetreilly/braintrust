-- Add document_id to private_threads for document-specific conversations
ALTER TABLE private_threads ADD COLUMN document_id TEXT;
ALTER TABLE private_threads ADD COLUMN document_name TEXT;
ALTER TABLE private_threads ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Index for finding threads by user+group+document
CREATE INDEX IF NOT EXISTS idx_private_threads_lookup ON private_threads(user_id, group_id, document_id);
