import { Hono } from 'hono'
import { verifyToken, decryptApiKey } from '../lib/auth'
import { callAI, getBrainSystemPrompt, getPrivateSystemPrompt } from '../lib/ai-providers'
import type { Env, User, AIProvider } from '../types'

const brain = new Hono<{ Bindings: Env }>()

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

// Get user's API key for a provider
async function getUserApiKey(
  db: D1Database,
  userId: string,
  provider: AIProvider,
  jwtSecret: string
): Promise<string | null> {
  const row = await db.prepare(
    'SELECT encrypted_key FROM user_api_keys WHERE user_id = ? AND provider = ? AND is_valid = 1'
  )
    .bind(userId, provider)
    .first()

  if (!row?.encrypted_key) return null
  return decryptApiKey(row.encrypted_key as string, jwtSecret)
}

// Get group's preferred provider
async function getGroupProvider(db: D1Database, groupId: string): Promise<AIProvider> {
  const row = await db.prepare(
    'SELECT preferred_provider FROM groups WHERE id = ?'
  )
    .bind(groupId)
    .first()

  return (row?.preferred_provider as AIProvider) || 'claude'
}

// Get recent messages for context
async function getRecentMessages(db: D1Database, groupId: string, limit: number = 20): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT content, type FROM messages
    WHERE group_id = ? AND type IN ('text', 'brain_response')
    ORDER BY created_at DESC
    LIMIT ?
  `)
    .bind(groupId, limit)
    .all()

  return (rows.results || []).map((r: any) => r.content).reverse()
}

// Handle @brain mention in group chat
brain.post('/respond', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, messageId, content } = await c.req.json<{
      groupId: string
      messageId: string
      content: string
    }>()

    // Get group info
    const group = await c.env.DB.prepare(
      'SELECT name, preferred_provider FROM groups WHERE id = ?'
    )
      .bind(groupId)
      .first()

    if (!group) {
      return c.json({ message: 'Group not found' }, 404)
    }

    const provider = (group.preferred_provider as AIProvider) || 'claude'

    // Try to get API key from user, fallback to mock
    const apiKey = await getUserApiKey(c.env.DB, user.id, provider, c.env.JWT_SECRET)

    // Get recent messages for context
    const recentMessages = await getRecentMessages(c.env.DB, groupId)

    // Build system prompt
    const systemPrompt = getBrainSystemPrompt({
      groupName: group.name as string,
      interests: [],
      recentTopics: recentMessages.slice(-5),
    })

    // Call AI
    const response = await callAI(
      provider,
      apiKey,
      systemPrompt,
      [
        ...recentMessages.map((msg, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: msg,
        })),
        { role: 'user' as const, content },
      ]
    )

    // Save Brain's response as a message
    const brainMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    // Use a special "brain" user ID
    const brainUserId = 'brain-' + groupId

    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, ai_provider, created_at)
      VALUES (?, ?, ?, 'brain_response', ?, ?, ?)
    `)
      .bind(brainMessageId, groupId, brainUserId, response.content, response.provider, createdAt)
      .run()

    return c.json({
      message: {
        id: brainMessageId,
        group_id: groupId,
        user_id: brainUserId,
        type: 'brain_response',
        content: response.content,
        ai_provider: response.provider,
        created_at: createdAt,
      },
    })
  } catch (error) {
    console.error('Brain respond error:', error)
    return c.json({ message: 'Brain encountered an error' }, 500)
  }
})

// Handle private thread message
brain.post('/private', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, message, context, history } = await c.req.json<{
      groupId: string
      message: string
      context?: string
      history?: { role: string; content: string }[]
    }>()

    // Get group provider
    const provider = await getGroupProvider(c.env.DB, groupId)

    // Try to get API key from user
    const apiKey = await getUserApiKey(c.env.DB, user.id, provider, c.env.JWT_SECRET)

    // Build system prompt
    const systemPrompt = getPrivateSystemPrompt({
      userName: user.name,
      contextMessage: context,
    })

    // Build messages from history
    const messages = [
      ...(history || []).map((h) => ({
        role: (h.role === 'brain' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message },
    ]

    // Call AI
    const response = await callAI(provider, apiKey, systemPrompt, messages)

    return c.json({ response: response.content })
  } catch (error) {
    console.error('Private thread error:', error)
    return c.json({ message: 'Brain encountered an error' }, 500)
  }
})

export default brain
