-- Migration 008: Organization profiles from employee CSV
-- Links users to their org role/responsibilities for personalized Brain responses

CREATE TABLE IF NOT EXISTS org_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  department TEXT,
  reports_to_email TEXT,
  level TEXT, -- 'executive', 'department_head', 'manager', 'Employee'
  alignment TEXT, -- WhyGO alignment or strategic priorities
  job_description TEXT,
  responsibilities TEXT,
  kpis TEXT,
  user_id TEXT, -- Linked when user signs up with matching email
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(workspace_id, email)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_org_profiles_workspace ON org_profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_org_profiles_email ON org_profiles(email);
CREATE INDEX IF NOT EXISTS idx_org_profiles_user ON org_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_org_profiles_department ON org_profiles(workspace_id, department);
