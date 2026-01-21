import { Hono } from 'hono'
import { verifyToken, encryptApiKey, decryptApiKey } from '../lib/auth'
import type { Env, Group, User } from '../types'

const groups = new Hono<{ Bindings: Env }>()

// Middleware to get current user
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
    workspace_id: (row.workspace_id as string) || undefined,
  }
}

// Generate random invite code
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// List user's groups
groups.get('/', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const rows = await c.env.DB.prepare(`
      SELECT g.id, g.name, g.invite_code, g.created_by, g.preferred_provider, g.created_at
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `)
      .bind(user.id)
      .all()

    const groupList: Group[] = (rows.results || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      invite_code: row.invite_code,
      created_by: row.created_by,
      preferred_provider: row.preferred_provider || 'claude',
      created_at: row.created_at,
    }))

    return c.json({ groups: groupList })
  } catch (error) {
    console.error('List groups error:', error)
    return c.json({ message: 'Failed to list groups' }, 500)
  }
})

// Create group
groups.post('/', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { name, preferred_provider } = await c.req.json<{
      name: string
      preferred_provider?: 'claude' | 'openai' | 'gemini'
    }>()

    if (!name?.trim()) {
      return c.json({ message: 'Group name is required' }, 400)
    }

    const id = crypto.randomUUID()
    const inviteCode = generateInviteCode()

    await c.env.DB.prepare(
      'INSERT INTO groups (id, name, invite_code, created_by, preferred_provider, workspace_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, name.trim(), inviteCode, user.id, preferred_provider || 'claude', user.workspace_id || null)
      .run()

    // Add creator as admin member
    await c.env.DB.prepare(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'
    )
      .bind(id, user.id, 'admin')
      .run()

    // Create taste profile
    await c.env.DB.prepare(
      'INSERT INTO taste_profiles (group_id) VALUES (?)'
    )
      .bind(id)
      .run()

    const group: Group = {
      id,
      name: name.trim(),
      invite_code: inviteCode,
      created_by: user.id,
      preferred_provider: preferred_provider || 'claude',
      created_at: new Date().toISOString(),
    }

    return c.json({ group })
  } catch (error) {
    console.error('Create group error:', error)
    return c.json({ message: 'Failed to create group' }, 500)
  }
})

// Get group by ID
groups.get('/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('id')

  try {
    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    const row = await c.env.DB.prepare(
      'SELECT id, name, invite_code, created_by, preferred_provider, created_at FROM groups WHERE id = ?'
    )
      .bind(groupId)
      .first()

    if (!row) {
      return c.json({ message: 'Group not found' }, 404)
    }

    const group: Group = {
      id: row.id as string,
      name: row.name as string,
      invite_code: row.invite_code as string,
      created_by: row.created_by as string,
      preferred_provider: (row.preferred_provider as Group['preferred_provider']) || 'claude',
      created_at: row.created_at as string,
    }

    return c.json({ group })
  } catch (error) {
    console.error('Get group error:', error)
    return c.json({ message: 'Failed to get group' }, 500)
  }
})

// Join group via invite code
groups.post('/join/:code', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const code = c.req.param('code').toUpperCase()

  try {
    const row = await c.env.DB.prepare(
      'SELECT id, name, invite_code, created_by, preferred_provider, created_at FROM groups WHERE invite_code = ?'
    )
      .bind(code)
      .first()

    if (!row) {
      return c.json({ message: 'Invalid invite code' }, 404)
    }

    // Check if already a member
    const existing = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(row.id, user.id)
      .first()

    if (!existing) {
      await c.env.DB.prepare(
        'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'
      )
        .bind(row.id, user.id, 'member')
        .run()
    }

    const group: Group = {
      id: row.id as string,
      name: row.name as string,
      invite_code: row.invite_code as string,
      created_by: row.created_by as string,
      preferred_provider: (row.preferred_provider as Group['preferred_provider']) || 'claude',
      created_at: row.created_at as string,
    }

    return c.json({ group })
  } catch (error) {
    console.error('Join group error:', error)
    return c.json({ message: 'Failed to join group' }, 500)
  }
})

// Set group API key (admin only)
groups.put('/:id/api-key', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('id')

  try {
    // Check if user is admin
    const membership = await c.env.DB.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first<{ role: string }>()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    if (membership.role !== 'admin') {
      return c.json({ message: 'Only admins can set the API key' }, 403)
    }

    const { apiKey } = await c.req.json<{ apiKey: string }>()

    if (!apiKey?.trim()) {
      return c.json({ message: 'API key is required' }, 400)
    }

    // Basic validation for Claude API key format
    if (!apiKey.startsWith('sk-ant-')) {
      return c.json({ message: 'Invalid Claude API key format' }, 400)
    }

    // Encrypt and store
    const encrypted = encryptApiKey(apiKey.trim(), c.env.JWT_SECRET)

    await c.env.DB.prepare(
      'UPDATE groups SET claude_api_key_encrypted = ? WHERE id = ?'
    )
      .bind(encrypted, groupId)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Set API key error:', error)
    return c.json({ message: 'Failed to set API key' }, 500)
  }
})

// Check if group has API key configured
groups.get('/:id/api-key/status', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('id')

  try {
    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    const row = await c.env.DB.prepare(
      'SELECT claude_api_key_encrypted FROM groups WHERE id = ?'
    )
      .bind(groupId)
      .first<{ claude_api_key_encrypted: string | null }>()

    return c.json({
      hasApiKey: !!row?.claude_api_key_encrypted
    })
  } catch (error) {
    console.error('Check API key error:', error)
    return c.json({ message: 'Failed to check API key' }, 500)
  }
})

// Delete group (admin only)
groups.delete('/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('id')

  try {
    // Check if user is admin
    const membership = await c.env.DB.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first<{ role: string }>()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    if (membership.role !== 'admin') {
      return c.json({ message: 'Only admins can delete channels' }, 403)
    }

    // Delete in order to respect foreign key constraints
    // Delete messages first
    await c.env.DB.prepare('DELETE FROM messages WHERE group_id = ?')
      .bind(groupId)
      .run()

    // Delete reactions (if any orphaned)
    await c.env.DB.prepare(`
      DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages)
    `).run()

    // Delete private threads and messages
    const threads = await c.env.DB.prepare('SELECT id FROM private_threads WHERE group_id = ?')
      .bind(groupId)
      .all()

    for (const thread of (threads.results || [])) {
      await c.env.DB.prepare('DELETE FROM private_messages WHERE thread_id = ?')
        .bind((thread as { id: string }).id)
        .run()
    }

    await c.env.DB.prepare('DELETE FROM private_threads WHERE group_id = ?')
      .bind(groupId)
      .run()

    // Delete taste profile
    await c.env.DB.prepare('DELETE FROM taste_profiles WHERE group_id = ?')
      .bind(groupId)
      .run()

    // Delete group members
    await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ?')
      .bind(groupId)
      .run()

    // Finally delete the group
    await c.env.DB.prepare('DELETE FROM groups WHERE id = ?')
      .bind(groupId)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete group error:', error)
    return c.json({ message: 'Failed to delete channel' }, 500)
  }
})

// Get group members
groups.get('/:id/members', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('id')

  try {
    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    const rows = await c.env.DB.prepare(`
      SELECT
        gm.group_id,
        gm.user_id,
        gm.role,
        gm.joined_at,
        u.email,
        u.name,
        u.avatar_url
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `)
      .bind(groupId)
      .all()

    const members = (rows.results || []).map((row: any) => ({
      group_id: row.group_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        avatar_url: row.avatar_url || undefined,
        interests: [],
        created_at: '',
      },
    }))

    return c.json({ members })
  } catch (error) {
    console.error('Get members error:', error)
    return c.json({ message: 'Failed to get members' }, 500)
  }
})

export default groups
