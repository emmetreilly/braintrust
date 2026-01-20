import { Hono } from 'hono'
import { verifyToken, decryptApiKey } from '../lib/auth'
import { callAI, getBrainSystemPrompt, getPrivateSystemPrompt } from '../lib/ai-providers'
import { buildRAGContext, searchSimilarMessages } from '../lib/vectorstore'
import { factCheckMessage, formatFactCheckResult } from '../lib/fact-checker'
import { generateDailySummary, generateWeeklySummary, generateTopicSummary, catchUp, formatSummary } from '../lib/summarizer'
import { parseArticle, summarizeArticle, extractUrls, getContentType } from '../lib/article-parser'
import { extractVideoId, processYouTubeVideo } from '../lib/youtube'
import { generateRecommendations, formatRecommendation } from '../lib/news-sources'
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

    // Build RAG context from similar past conversations
    let ragContext = ''
    try {
      ragContext = await buildRAGContext(c.env, content, groupId, {
        limit: 5,
        provider: 'cloudflare',
        userId: user.id,
      })
    } catch (error) {
      console.error('Failed to build RAG context:', error)
      // Continue without RAG context
    }

    // Build system prompt with RAG context
    const systemPrompt = getBrainSystemPrompt({
      groupName: group.name as string,
      interests: [],
      recentTopics: recentMessages.slice(-5),
      ragContext, // Add RAG context to system prompt
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

// Fact check a claim or message
brain.post('/fact-check', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, content } = await c.req.json<{
      groupId: string
      content: string
    }>()

    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getUserApiKey(c.env.DB, user.id, provider, c.env.JWT_SECRET)

    const results = await factCheckMessage(c.env, content, {
      apiKey: apiKey || undefined,
      provider,
      maxClaims: 3,
    })

    if (results.length === 0) {
      return c.json({
        response: "I couldn't identify any specific factual claims to verify in that message.",
      })
    }

    const formattedResults = results.map(formatFactCheckResult).join('\n---\n')

    return c.json({ response: formattedResults, results })
  } catch (error) {
    console.error('Fact check error:', error)
    return c.json({ message: 'Fact checking failed' }, 500)
  }
})

// Summarize conversation
brain.post('/summarize', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, type, topic } = await c.req.json<{
      groupId: string
      type: 'daily' | 'weekly' | 'topic' | 'catchup'
      topic?: string
    }>()

    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getUserApiKey(c.env.DB, user.id, provider, c.env.JWT_SECRET)

    let response: string

    if (type === 'catchup') {
      response = await catchUp(c.env, groupId, user.id, {
        apiKey: apiKey || undefined,
        provider,
      })
    } else if (type === 'topic' && topic) {
      const topicSummary = await generateTopicSummary(c.env, groupId, topic, {
        apiKey: apiKey || undefined,
        provider,
      })
      response = `**Topic: ${topicSummary.topic}**\n\n${topicSummary.summary}\n\n`
      if (topicSummary.keyPoints.length > 0) {
        response += `**Key Points:**\n${topicSummary.keyPoints.map(p => `- ${p}`).join('\n')}\n\n`
      }
      if (topicSummary.participants.length > 0) {
        response += `**Discussed by:** ${topicSummary.participants.join(', ')}`
      }
    } else if (type === 'weekly') {
      const summary = await generateWeeklySummary(c.env, groupId, new Date(), {
        apiKey: apiKey || undefined,
        provider,
      })
      response = formatSummary(summary)
    } else {
      const summary = await generateDailySummary(c.env, groupId, new Date(), {
        apiKey: apiKey || undefined,
        provider,
      })
      response = formatSummary(summary)
    }

    return c.json({ response })
  } catch (error) {
    console.error('Summarize error:', error)
    return c.json({ message: 'Summarization failed' }, 500)
  }
})

// Analyze shared media (articles, videos)
brain.post('/analyze-media', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, url } = await c.req.json<{
      groupId: string
      url: string
    }>()

    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getUserApiKey(c.env.DB, user.id, provider, c.env.JWT_SECRET)

    const contentType = getContentType(url)
    let response: string

    if (contentType === 'video') {
      // YouTube video
      const videoId = extractVideoId(url)
      if (!videoId) {
        return c.json({ response: "I couldn't recognize that video URL." })
      }

      const result = await processYouTubeVideo(c.env, url, {
        apiKey: apiKey || undefined,
        provider,
      })

      response = `**${result.videoInfo.title}**\n_${result.videoInfo.channelName}_\n\n`

      if (result.summary) {
        response += `**Summary:**\n${result.summary.summary}\n\n`
        if (result.summary.keyPoints.length > 0) {
          response += `**Key Points:**\n${result.summary.keyPoints.map(p => `- ${p}`).join('\n')}\n\n`
        }
        if (result.summary.timestamps && result.summary.timestamps.length > 0) {
          response += `**Timestamps:**\n${result.summary.timestamps.map(t => `- ${t.time}: ${t.description}`).join('\n')}`
        }
      } else if (result.error) {
        response += `_Note: ${result.error}_`
      }
    } else {
      // Article
      const article = await parseArticle(url)
      const summary = await summarizeArticle(c.env, article, {
        apiKey: apiKey || undefined,
        provider,
      })

      response = `**${article.title}**\n_${article.siteName}${article.author ? ` by ${article.author}` : ''}_\n\n`
      response += `**Summary:**\n${summary.summary}\n\n`

      if (summary.keyPoints.length > 0) {
        response += `**Key Points:**\n${summary.keyPoints.map(p => `- ${p}`).join('\n')}\n\n`
      }

      if (summary.topics.length > 0) {
        response += `**Topics:** ${summary.topics.join(', ')}\n\n`
      }

      response += `_${article.wordCount} words_`
    }

    return c.json({ response })
  } catch (error) {
    console.error('Media analysis error:', error)
    return c.json({ message: 'Media analysis failed' }, 500)
  }
})

// Get recommendations for the group
brain.post('/recommend', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, limit } = await c.req.json<{
      groupId: string
      limit?: number
    }>()

    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getUserApiKey(c.env.DB, user.id, provider, c.env.JWT_SECRET)

    const recommendations = await generateRecommendations(c.env, groupId, {
      apiKey: apiKey || undefined,
      provider,
      limit: limit || 3,
    })

    if (recommendations.length === 0) {
      return c.json({
        response: "I don't have enough conversation history yet to make good recommendations. Keep chatting and I'll learn your interests!",
      })
    }

    const formatted = recommendations.map(formatRecommendation).join('\n\n---\n\n')

    return c.json({ response: formatted, recommendations })
  } catch (error) {
    console.error('Recommendation error:', error)
    return c.json({ message: 'Recommendation failed' }, 500)
  }
})

// Search memory (past conversations)
brain.post('/search-memory', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, query, limit } = await c.req.json<{
      groupId: string
      query: string
      limit?: number
    }>()

    const results = await searchSimilarMessages(c.env, query, groupId, {
      limit: limit || 10,
      provider: 'cloudflare',
      userId: user.id,
      minScore: 0.5,
    })

    if (results.length === 0) {
      return c.json({
        response: "I couldn't find any relevant past conversations about that topic.",
        results: [],
      })
    }

    const formatted = results.map((r, i) => {
      const date = new Date(r.metadata.createdAt).toLocaleDateString()
      return `**[${i + 1}]** ${r.metadata.authorName || 'Someone'} (${date}):\n"${r.metadata.content}"\n_Relevance: ${Math.round(r.score * 100)}%_`
    }).join('\n\n')

    return c.json({
      response: `Found ${results.length} relevant messages:\n\n${formatted}`,
      results,
    })
  } catch (error) {
    console.error('Search memory error:', error)
    return c.json({ message: 'Memory search failed' }, 500)
  }
})

export default brain
