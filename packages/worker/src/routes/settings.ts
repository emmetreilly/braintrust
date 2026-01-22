import { Hono } from 'hono'
import { verifyToken, encryptApiKey, decryptApiKey } from '../lib/auth'
import type { Env, User, AIProvider } from '../types'

const settings = new Hono<{ Bindings: Env }>()

// Get current user with workspace
async function getUser(c: any): Promise<(User & { workspace_id?: string }) | null> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return null

  const row = await c.env.DB.prepare(
    'SELECT id, email, name, avatar_url, interests, created_at, workspace_id FROM users WHERE id = ?'
  )
    .bind(payload.sub)
    .first()

  if (!row) return null

  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    avatar_url: (row.avatar_url as string) || undefined,
    interests: JSON.parse((row.interests as string) || '[]'),
    created_at: row.created_at as string,
    workspace_id: row.workspace_id as string | undefined,
  }
}

// Get user's API keys (masked)
settings.get('/api-keys', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const rows = await c.env.DB.prepare(`
      SELECT provider, is_valid, created_at, updated_at
      FROM user_api_keys
      WHERE user_id = ?
    `)
      .bind(user.id)
      .all()

    const keys = (rows.results || []).map((row: any) => ({
      provider: row.provider,
      is_valid: !!row.is_valid,
      has_key: true,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    // Add missing providers
    const providers: AIProvider[] = ['claude', 'openai', 'gemini']
    for (const provider of providers) {
      if (!keys.find((k: any) => k.provider === provider)) {
        keys.push({
          provider,
          is_valid: false,
          has_key: false,
          created_at: null,
          updated_at: null,
        })
      }
    }

    return c.json({ keys })
  } catch (error) {
    console.error('Get API keys error:', error)
    return c.json({ message: 'Failed to get API keys' }, 500)
  }
})

// Save or update API key
settings.post('/api-keys', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { provider, key } = await c.req.json<{
      provider: AIProvider
      key: string
    }>()

    if (!['claude', 'openai', 'gemini'].includes(provider)) {
      return c.json({ message: 'Invalid provider' }, 400)
    }

    if (!key?.trim()) {
      return c.json({ message: 'API key is required' }, 400)
    }

    // Encrypt the key
    const encryptedKey = encryptApiKey(key.trim(), c.env.JWT_SECRET)
    const now = new Date().toISOString()

    // Check if key exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM user_api_keys WHERE user_id = ? AND provider = ?'
    )
      .bind(user.id, provider)
      .first()

    if (existing) {
      await c.env.DB.prepare(`
        UPDATE user_api_keys
        SET encrypted_key = ?, is_valid = 1, updated_at = ?
        WHERE id = ?
      `)
        .bind(encryptedKey, now, existing.id)
        .run()
    } else {
      const id = crypto.randomUUID()
      await c.env.DB.prepare(`
        INSERT INTO user_api_keys (id, user_id, provider, encrypted_key, is_valid, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `)
        .bind(id, user.id, provider, encryptedKey, now, now)
        .run()
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Save API key error:', error)
    return c.json({ message: 'Failed to save API key' }, 500)
  }
})

// Delete API key
settings.delete('/api-keys/:provider', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const provider = c.req.param('provider')

  try {
    await c.env.DB.prepare(
      'DELETE FROM user_api_keys WHERE user_id = ? AND provider = ?'
    )
      .bind(user.id, provider)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete API key error:', error)
    return c.json({ message: 'Failed to delete API key' }, 500)
  }
})

// Validate API key (test if it works)
settings.post('/api-keys/validate', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { provider, key } = await c.req.json<{
      provider: AIProvider
      key: string
    }>()

    let isValid = false
    let error = ''

    try {
      switch (provider) {
        case 'claude': {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hi' }],
            }),
          })
          isValid = response.ok
          if (!isValid) {
            const err = await response.json() as { error?: { message?: string } }
            error = err.error?.message || 'Invalid API key'
          }
          break
        }
        case 'openai': {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${key}` },
          })
          isValid = response.ok
          if (!isValid) {
            error = 'Invalid API key'
          }
          break
        }
        case 'gemini': {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
          )
          isValid = response.ok
          if (!isValid) {
            error = 'Invalid API key'
          }
          break
        }
      }
    } catch (e) {
      error = 'Failed to validate key'
    }

    return c.json({ isValid, error })
  } catch (error) {
    console.error('Validate API key error:', error)
    return c.json({ message: 'Failed to validate API key' }, 500)
  }
})

// ============ WORKSPACE SETTINGS ============

// Get workspace API key status
settings.get('/workspace/api-key', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    // Get user's workspace
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    const workspace = await c.env.DB.prepare(
      'SELECT id, name, domain, claude_api_key_encrypted FROM workspaces WHERE id = ?'
    )
      .bind(userRow.workspace_id)
      .first()

    if (!workspace) {
      return c.json({ message: 'Workspace not found' }, 404)
    }

    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        domain: workspace.domain,
      },
      hasApiKey: !!workspace.claude_api_key_encrypted,
    })
  } catch (error) {
    console.error('Get workspace API key status error:', error)
    return c.json({ message: 'Failed to get workspace settings' }, 500)
  }
})

// Set workspace API key
settings.post('/workspace/api-key', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    // Get user's workspace
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    const { apiKey } = await c.req.json<{ apiKey: string }>()

    if (!apiKey?.trim()) {
      return c.json({ message: 'API key is required' }, 400)
    }

    // Basic validation for Claude API key format
    if (!apiKey.startsWith('sk-ant-')) {
      return c.json({ message: 'Invalid Claude API key format. Key should start with sk-ant-' }, 400)
    }

    // Encrypt and store
    const encrypted = encryptApiKey(apiKey.trim(), c.env.JWT_SECRET)

    await c.env.DB.prepare(
      'UPDATE workspaces SET claude_api_key_encrypted = ? WHERE id = ?'
    )
      .bind(encrypted, userRow.workspace_id)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Set workspace API key error:', error)
    return c.json({ message: 'Failed to set workspace API key' }, 500)
  }
})

// Delete workspace API key
settings.delete('/workspace/api-key', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    // Get user's workspace
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    await c.env.DB.prepare(
      'UPDATE workspaces SET claude_api_key_encrypted = NULL WHERE id = ?'
    )
      .bind(userRow.workspace_id)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete workspace API key error:', error)
    return c.json({ message: 'Failed to delete workspace API key' }, 500)
  }
})

// ============ WORKSPACE REFERENCE DOCS ============

// Get workspace reference docs
settings.get('/workspace/reference-docs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    const rows = await c.env.DB.prepare(`
      SELECT d.id, d.filename, d.file_size, d.created_at, u.name as created_by_name
      FROM workspace_reference_docs d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.workspace_id = ?
      ORDER BY d.created_at DESC
    `)
      .bind(userRow.workspace_id)
      .all()

    return c.json({
      documents: (rows.results || []).map((r: any) => ({
        id: r.id,
        filename: r.filename,
        fileSize: r.file_size,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
      })),
    })
  } catch (error) {
    console.error('Get workspace reference docs error:', error)
    return c.json({ message: 'Failed to get reference docs' }, 500)
  }
})

// Upload workspace reference doc
settings.post('/workspace/reference-docs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    const { filename, content } = await c.req.json<{
      filename: string
      content: string
    }>()

    if (!filename?.trim() || !content?.trim()) {
      return c.json({ message: 'Filename and content are required' }, 400)
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await c.env.DB.prepare(`
      INSERT INTO workspace_reference_docs (id, workspace_id, filename, content_text, file_size, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(id, userRow.workspace_id, filename.trim(), content, content.length, user.id, now)
      .run()

    return c.json({
      document: {
        id,
        filename: filename.trim(),
        fileSize: content.length,
        createdAt: now,
        createdByName: user.name,
      },
    })
  } catch (error) {
    console.error('Upload workspace reference doc error:', error)
    return c.json({ message: 'Failed to upload reference doc' }, 500)
  }
})

// Delete workspace reference doc
settings.delete('/workspace/reference-docs/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    // Verify doc belongs to this workspace
    const doc = await c.env.DB.prepare(
      'SELECT id FROM workspace_reference_docs WHERE id = ? AND workspace_id = ?'
    )
      .bind(docId, userRow.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    await c.env.DB.prepare('DELETE FROM workspace_reference_docs WHERE id = ?')
      .bind(docId)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete workspace reference doc error:', error)
    return c.json({ message: 'Failed to delete reference doc' }, 500)
  }
})

// ============ ORG PROFILES (EMPLOYEE DATA) ============

// Get org profiles for workspace
settings.get('/workspace/org-profiles', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    const rows = await c.env.DB.prepare(`
      SELECT op.*, u.name as linked_user_name
      FROM org_profiles op
      LEFT JOIN users u ON op.user_id = u.id
      WHERE op.workspace_id = ?
      ORDER BY op.department, op.name
    `)
      .bind(userRow.workspace_id)
      .all()

    return c.json({
      profiles: (rows.results || []).map((r: any) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        title: r.title,
        department: r.department,
        reportsTo: r.reports_to_email,
        level: r.level,
        alignment: r.alignment,
        jobDescription: r.job_description,
        responsibilities: r.responsibilities,
        kpis: r.kpis,
        userId: r.user_id,
        linkedUserName: r.linked_user_name,
      })),
    })
  } catch (error) {
    console.error('Get org profiles error:', error)
    return c.json({ message: 'Failed to get org profiles' }, 500)
  }
})

// Upload org CSV (parses and stores employee data)
settings.post('/workspace/org-profiles/upload-csv', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const userRow = await c.env.DB.prepare(
      'SELECT workspace_id FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first()

    if (!userRow?.workspace_id) {
      return c.json({ message: 'No workspace found' }, 404)
    }

    const { csvContent, replaceExisting } = await c.req.json<{
      csvContent: string
      replaceExisting?: boolean
    }>()

    if (!csvContent?.trim()) {
      return c.json({ message: 'CSV content is required' }, 400)
    }

    // Parse CSV
    const lines = csvContent.trim().split('\n')
    if (lines.length < 2) {
      return c.json({ message: 'CSV must have header row and at least one data row' }, 400)
    }

    // Parse header to find column indices
    const header = parseCSVLine(lines[0])
    const colIndex: Record<string, number> = {}
    header.forEach((col, i) => {
      const normalized = col.toLowerCase().trim()
      if (normalized.includes('name') && !normalized.includes('description')) colIndex.name = i
      if (normalized.includes('email')) colIndex.email = i
      if (normalized.includes('title')) colIndex.title = i
      if (normalized.includes('department')) colIndex.department = i
      if (normalized.includes('reports')) colIndex.reportsTo = i
      if (normalized.includes('level')) colIndex.level = i
      if (normalized.includes('alignment') || normalized.includes('whygo')) colIndex.alignment = i
      if (normalized.includes('job description')) colIndex.jobDescription = i
      if (normalized.includes('responsibilities')) colIndex.responsibilities = i
      if (normalized.includes('kpi')) colIndex.kpis = i
    })

    if (colIndex.email === undefined || colIndex.name === undefined) {
      return c.json({ message: 'CSV must have Name and Email columns' }, 400)
    }

    // Clear existing if requested
    if (replaceExisting) {
      await c.env.DB.prepare('DELETE FROM org_profiles WHERE workspace_id = ?')
        .bind(userRow.workspace_id)
        .run()
    }

    // Parse data rows and insert
    let inserted = 0
    let updated = 0
    const now = new Date().toISOString()

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i])
      if (row.length < 2) continue

      const email = row[colIndex.email]?.trim().toLowerCase()
      const name = row[colIndex.name]?.trim()
      if (!email || !name) continue

      const profile = {
        email,
        name,
        title: row[colIndex.title]?.trim() || null,
        department: row[colIndex.department]?.trim() || null,
        reportsTo: row[colIndex.reportsTo]?.trim() || null,
        level: row[colIndex.level]?.trim() || null,
        alignment: row[colIndex.alignment]?.trim() || null,
        jobDescription: row[colIndex.jobDescription]?.trim() || null,
        responsibilities: row[colIndex.responsibilities]?.trim() || null,
        kpis: row[colIndex.kpis]?.trim() || null,
      }

      // Check if profile exists
      const existing = await c.env.DB.prepare(
        'SELECT id FROM org_profiles WHERE workspace_id = ? AND email = ?'
      )
        .bind(userRow.workspace_id, email)
        .first()

      if (existing) {
        // Update
        await c.env.DB.prepare(`
          UPDATE org_profiles SET
            name = ?, title = ?, department = ?, reports_to_email = ?,
            level = ?, alignment = ?, job_description = ?, responsibilities = ?,
            kpis = ?, updated_at = ?
          WHERE id = ?
        `)
          .bind(
            profile.name, profile.title, profile.department, profile.reportsTo,
            profile.level, profile.alignment, profile.jobDescription, profile.responsibilities,
            profile.kpis, now, existing.id
          )
          .run()
        updated++
      } else {
        // Insert new
        const id = crypto.randomUUID()

        // Check if a user with this email already exists in the workspace
        const existingUser = await c.env.DB.prepare(
          'SELECT id FROM users WHERE email = ? AND workspace_id = ?'
        )
          .bind(email, userRow.workspace_id)
          .first()

        await c.env.DB.prepare(`
          INSERT INTO org_profiles (
            id, workspace_id, email, name, title, department, reports_to_email,
            level, alignment, job_description, responsibilities, kpis, user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            id, userRow.workspace_id, email, profile.name, profile.title, profile.department,
            profile.reportsTo, profile.level, profile.alignment, profile.jobDescription,
            profile.responsibilities, profile.kpis, existingUser?.id || null, now
          )
          .run()
        inserted++
      }
    }

    // Also store the CSV as a reference doc so Brain can see the full org structure
    const refDocId = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO workspace_reference_docs (id, workspace_id, filename, content_text, file_size, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(refDocId, userRow.workspace_id, 'employees_org_structure.csv', csvContent, csvContent.length, user.id, now)
      .run()

    return c.json({
      success: true,
      inserted,
      updated,
      total: inserted + updated,
      referenceDocId: refDocId,
    })
  } catch (error) {
    console.error('Upload org CSV error:', error)
    return c.json({ message: 'Failed to upload org data' }, 500)
  }
})

// Helper function to parse CSV line (handles quoted fields with commas)
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

// Get current user's org profile
settings.get('/workspace/my-org-profile', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const profile = await c.env.DB.prepare(`
      SELECT * FROM org_profiles WHERE user_id = ?
    `)
      .bind(user.id)
      .first()

    if (!profile) {
      return c.json({ profile: null })
    }

    return c.json({
      profile: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        title: profile.title,
        department: profile.department,
        reportsTo: profile.reports_to_email,
        level: profile.level,
        alignment: profile.alignment,
        jobDescription: profile.job_description,
        responsibilities: profile.responsibilities,
        kpis: profile.kpis,
      },
    })
  } catch (error) {
    console.error('Get my org profile error:', error)
    return c.json({ message: 'Failed to get org profile' }, 500)
  }
})

// ============ CHANNEL REFERENCE DOCS ============

// Get channel documents (ALL docs shared to this channel, with is_reference status)
settings.get('/channel/:groupId/reference-docs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')

  try {
    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Access denied' }, 403)
    }

    // Get group's workspace_id
    const group = await c.env.DB.prepare('SELECT workspace_id FROM groups WHERE id = ?')
      .bind(groupId)
      .first()

    if (!group?.workspace_id) {
      return c.json({ documents: [] })
    }

    // Get ALL documents shared to this channel (not just reference docs)
    const rows = await c.env.DB.prepare(`
      SELECT DISTINCT d.id, d.filename, d.file_size, d.is_reference, d.created_at, u.name as uploaded_by
      FROM documents d
      JOIN messages m ON m.group_id = ? AND m.type = 'media' AND m.deleted_at IS NULL
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.workspace_id = ?
        AND json_extract(m.media_data, '$.documentId') = d.id
      ORDER BY d.created_at DESC
    `)
      .bind(groupId, group.workspace_id)
      .all()

    // Fetch tags for each document
    const documents = await Promise.all(
      (rows.results || []).map(async (r: any) => {
        const tagRows = await c.env.DB.prepare(`
          SELECT t.id, t.name, t.color, t.tag_type
          FROM document_tags t
          JOIN document_tag_assignments dta ON t.id = dta.tag_id
          WHERE dta.document_id = ?
        `)
          .bind(r.id)
          .all()

        return {
          id: r.id,
          filename: r.filename,
          file_size: r.file_size,
          is_reference: !!r.is_reference,
          created_at: r.created_at,
          uploaded_by: r.uploaded_by,
          tags: (tagRows.results || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            tag_type: t.tag_type,
          })),
        }
      })
    )

    return c.json({ documents })
  } catch (error) {
    console.error('Get channel reference docs error:', error)
    return c.json({ message: 'Failed to get reference docs' }, 500)
  }
})

// Toggle channel reference doc status
settings.post('/channel/:groupId/reference-docs/:docId/toggle', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')
  const docId = c.req.param('docId')

  try {
    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Access denied' }, 403)
    }

    // Get current state
    const doc = await c.env.DB.prepare('SELECT is_reference FROM documents WHERE id = ?')
      .bind(docId)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    const newState = !doc.is_reference

    await c.env.DB.prepare('UPDATE documents SET is_reference = ? WHERE id = ?')
      .bind(newState ? 1 : 0, docId)
      .run()

    return c.json({ success: true, isReference: newState })
  } catch (error) {
    console.error('Toggle channel reference doc error:', error)
    return c.json({ message: 'Failed to toggle reference doc' }, 500)
  }
})

// Upload a document directly to a channel (creates doc + shares it in one step)
settings.post('/channel/:groupId/upload-doc', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')

  try {
    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Access denied' }, 403)
    }

    // Get workspace_id from the user (users are linked to workspaces)
    if (!user.workspace_id) {
      return c.json({ message: 'No workspace found for user' }, 404)
    }
    const workspaceId = user.workspace_id

    const { filename, content, pinAsReference } = await c.req.json<{
      filename: string
      content: string
      pinAsReference?: boolean
    }>()

    if (!filename?.trim() || !content?.trim()) {
      return c.json({ message: 'Filename and content are required' }, 400)
    }

    const docId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    const now = new Date().toISOString()

    // Create the document (r2_key is 'inline' for text-only uploads)
    await c.env.DB.prepare(`
      INSERT INTO documents (id, workspace_id, uploaded_by, filename, file_type, mime_type, file_size, r2_key, content_text, is_reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(docId, workspaceId, user.id, filename.trim(), 'text', 'text/plain', content.length, `inline:${docId}`, content, pinAsReference ? 1 : 0, now)
      .run()

    // Create a message to share it in the channel
    const mediaData = JSON.stringify({
      type: 'document',
      documentId: docId,
      filename: filename.trim(),
      fileSize: content.length,
    })

    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, content, type, media_data, created_at)
      VALUES (?, ?, ?, ?, 'media', ?, ?)
    `)
      .bind(messageId, groupId, user.id, `Shared document: ${filename.trim()}`, mediaData, now)
      .run()

    return c.json({
      document: {
        id: docId,
        filename: filename.trim(),
        file_size: content.length,
        is_reference: !!pinAsReference,
        created_at: now,
        uploaded_by: user.name,
      },
      messageId,
    })
  } catch (error) {
    console.error('Upload channel doc error:', error)
    return c.json({ message: 'Failed to upload document' }, 500)
  }
})

export default settings
