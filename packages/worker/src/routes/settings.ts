import { Hono } from 'hono'
import { verifyToken, encryptApiKey, decryptApiKey } from '../lib/auth'
import type { Env, User, AIProvider } from '../types'

const settings = new Hono<{ Bindings: Env }>()

// Get current user
async function getUser(c: any): Promise<User | null> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return null

  const row = await c.env.DB.prepare(
    'SELECT id, email, name, avatar_url, interests, created_at FROM users WHERE id = ?'
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

export default settings
