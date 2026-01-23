-- Create the brain-system user for Brain responses
-- This user is used when Brain responds in chat

INSERT OR IGNORE INTO users (id, email, name, avatar_url, interests, created_at)
VALUES (
  'brain-system',
  'brain@system.local',
  'Brain',
  NULL,
  '[]',
  datetime('now')
);
