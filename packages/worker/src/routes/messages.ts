import { Hono } from 'hono'
import { verifyToken } from '../lib/auth'
import type { Env, Message, User } from '../types'

const messages = new Hono<{ Bindings: Env }>()

// Middleware to get current user
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

// Check if user is member of group
async function isMember(db: D1Database, groupId: string, userId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
  )
    .bind(groupId, userId)
    .first()
  return !!row
}

// Get messages for a group
messages.get('/groups/:groupId/messages', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')
  const cursor = c.req.query('cursor')
  const limit = 50

  try {
    if (!await isMember(c.env.DB, groupId, user.id)) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    let query = `
      SELECT
        m.id,
        m.group_id,
        m.user_id,
        m.type,
        m.content,
        m.media_data,
        m.ai_provider,
        m.created_at,
        u.name as author_name,
        u.avatar_url as author_avatar
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.group_id = ?
    `

    const params: any[] = [groupId]

    if (cursor) {
      query += ' AND m.created_at < ?'
      params.push(cursor)
    }

    query += ' ORDER BY m.created_at DESC LIMIT ?'
    params.push(limit + 1)

    const rows = await c.env.DB.prepare(query).bind(...params).all()
    const results = rows.results || []

    // Check if there are more results
    const hasMore = results.length > limit
    const messageRows = hasMore ? results.slice(0, limit) : results

    // Get reactions for these messages
    const messageIds = messageRows.map((r: any) => r.id)
    let reactions: any[] = []

    if (messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',')
      const reactionsResult = await c.env.DB.prepare(`
        SELECT id, message_id, user_id, emoji, created_at
        FROM reactions
        WHERE message_id IN (${placeholders})
      `).bind(...messageIds).all()
      reactions = reactionsResult.results || []
    }

    // Group reactions by message
    const reactionsByMessage = new Map<string, any[]>()
    for (const r of reactions) {
      const existing = reactionsByMessage.get(r.message_id as string) || []
      existing.push(r)
      reactionsByMessage.set(r.message_id as string, existing)
    }

    const messageList: Message[] = messageRows.map((row: any) => ({
      id: row.id,
      group_id: row.group_id,
      user_id: row.user_id,
      type: row.type,
      content: row.content,
      media_data: row.media_data || undefined,
      ai_provider: row.ai_provider || undefined,
      created_at: row.created_at,
      author: {
        id: row.user_id,
        email: '',
        name: row.author_name || 'Unknown',
        avatar_url: row.author_avatar || undefined,
        interests: [],
        created_at: '',
      },
      reactions: reactionsByMessage.get(row.id) || [],
    }))

    // Reverse to get chronological order
    messageList.reverse()

    return c.json({
      messages: messageList,
      nextCursor: hasMore ? messageRows[messageRows.length - 1].created_at : undefined,
    })
  } catch (error) {
    console.error('Get messages error:', error)
    return c.json({ message: 'Failed to get messages' }, 500)
  }
})

// Send a message
messages.post('/groups/:groupId/messages', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')

  try {
    if (!await isMember(c.env.DB, groupId, user.id)) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    const { content, type = 'text', media_data } = await c.req.json<{
      content: string
      type?: string
      media_data?: string
    }>()

    if (!content?.trim()) {
      return c.json({ message: 'Content is required' }, 400)
    }

    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, media_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(id, groupId, user.id, type, content.trim(), media_data || null, createdAt)
      .run()

    const message: Message = {
      id,
      group_id: groupId,
      user_id: user.id,
      type: type as Message['type'],
      content: content.trim(),
      media_data,
      created_at: createdAt,
    }

    return c.json({ message })
  } catch (error) {
    console.error('Send message error:', error)
    return c.json({ message: 'Failed to send message' }, 500)
  }
})

// Add/toggle reaction
messages.post('/messages/:messageId/reactions', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const messageId = c.req.param('messageId')

  try {
    const { emoji } = await c.req.json<{ emoji: string }>()

    if (!emoji) {
      return c.json({ message: 'Emoji is required' }, 400)
    }

    // Get message to verify user has access
    const msg = await c.env.DB.prepare(
      'SELECT group_id FROM messages WHERE id = ?'
    )
      .bind(messageId)
      .first()

    if (!msg) {
      return c.json({ message: 'Message not found' }, 404)
    }

    if (!await isMember(c.env.DB, msg.group_id as string, user.id)) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    // Check if reaction exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    )
      .bind(messageId, user.id, emoji)
      .first()

    if (existing) {
      // Remove reaction
      await c.env.DB.prepare(
        'DELETE FROM reactions WHERE id = ?'
      )
        .bind(existing.id)
        .run()

      return c.json({ removed: true })
    } else {
      // Add reaction
      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()

      await c.env.DB.prepare(
        'INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(id, messageId, user.id, emoji, createdAt)
        .run()

      return c.json({
        reaction: {
          id,
          message_id: messageId,
          user_id: user.id,
          emoji,
          created_at: createdAt,
        },
      })
    }
  } catch (error) {
    console.error('Reaction error:', error)
    return c.json({ message: 'Failed to add reaction' }, 500)
  }
})

export default messages
