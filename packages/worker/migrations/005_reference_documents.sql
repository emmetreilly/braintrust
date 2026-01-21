-- Migration 005: Add is_reference flag to documents
-- Reference documents are always loaded into Brain's system prompt for that channel
-- They provide rules, templates, and guidelines that Brain should follow

ALTER TABLE documents ADD COLUMN is_reference BOOLEAN DEFAULT FALSE;

-- Index for efficient lookup of reference docs by channel
CREATE INDEX IF NOT EXISTS idx_documents_is_reference ON documents(is_reference);
