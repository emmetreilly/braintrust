import { Hono } from 'hono'
import { verifyToken } from '../lib/auth'
import type { Env, User, IndexedItem } from '../types'

const search = new Hono<{ Bindings: Env }>()

// Auth middleware
async function getUser(c: any): Promise<User | null> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  try {
    const token = authHeader.slice(7)
    const payload = await verifyToken(token, c.env.JWT_SECRET)
    if (!payload) return null
    const result = await c.env.DB.prepare(
      'SELECT u.*, w.name as workspace_name FROM users u LEFT JOIN workspaces w ON u.workspace_id = w.id WHERE u.id = ?'
    ).bind(payload.sub).first()
    return result as User | null
  } catch {
    return null
  }
}

// Main search endpoint
search.post('/', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const { query, filters } = await c.req.json<{
    query: string
    filters?: {
      sources?: string[]
      dateRange?: { from: string; to: string }
      authors?: string[]
      channels?: string[]
    }
  }>()

  if (!query?.trim()) {
    return c.json({ error: 'Query required' }, 400)
  }

  try {
    // 1. Generate embedding for the query
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
      }),
    })

    const embeddingData = await embeddingResponse.json() as any
    const queryEmbedding = embeddingData.data?.[0]?.embedding

    // 2. Search Vectorize for similar items
    let vectorResults: { id: string; score: number }[] = []
    if (queryEmbedding && c.env.VECTORIZE) {
      try {
        const vectorQuery = await c.env.VECTORIZE.query(queryEmbedding, {
          topK: 20,
          filter: { workspace_id: user.workspace_id },
        })
        vectorResults = vectorQuery.matches?.map((m: any) => ({
          id: m.id,
          score: m.score,
        })) || []
      } catch (err) {
        console.error('Vectorize query error:', err)
      }
    }

    // 3. Also do keyword search in D1
    let sqlQuery = `
      SELECT id, source, source_id, source_url, title, content, content_type,
             author_name, author_email, created_at, channel_name, file_name
      FROM indexed_items
      WHERE workspace_id = ?
        AND (content LIKE ? OR title LIKE ? OR file_name LIKE ?)
    `
    const searchPattern = `%${query}%`
    const params: any[] = [user.workspace_id, searchPattern, searchPattern, searchPattern]

    // Apply filters
    if (filters?.sources?.length) {
      sqlQuery += ` AND source IN (${filters.sources.map(() => '?').join(',')})`
      params.push(...filters.sources)
    }

    if (filters?.dateRange?.from) {
      sqlQuery += ` AND created_at >= ?`
      params.push(filters.dateRange.from)
    }

    if (filters?.dateRange?.to) {
      sqlQuery += ` AND created_at <= ?`
      params.push(filters.dateRange.to)
    }

    if (filters?.authors?.length) {
      sqlQuery += ` AND author_email IN (${filters.authors.map(() => '?').join(',')})`
      params.push(...filters.authors)
    }

    sqlQuery += ` ORDER BY created_at DESC LIMIT 50`

    const keywordResults = await c.env.DB.prepare(sqlQuery).bind(...params).all<IndexedItem>()

    // 4. Combine and deduplicate results
    const resultMap = new Map<string, IndexedItem & { score?: number }>()

    // Add vector results first (higher priority)
    for (const vr of vectorResults) {
      const item = await c.env.DB.prepare(
        'SELECT * FROM indexed_items WHERE id = ?'
      ).bind(vr.id).first<IndexedItem>()
      if (item) {
        resultMap.set(item.id, { ...item, score: vr.score })
      }
    }

    // Add keyword results
    for (const kr of keywordResults.results || []) {
      if (!resultMap.has(kr.id)) {
        resultMap.set(kr.id, { ...kr, score: 0.5 }) // Lower score for keyword-only matches
      }
    }

    const combinedResults = Array.from(resultMap.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10)

    // 5. Get people stats for context
    const authorEmails = [...new Set(combinedResults.map(r => r.author_email).filter(Boolean))]
    let peopleStats: any[] = []
    if (authorEmails.length > 0) {
      const peopleResult = await c.env.DB.prepare(`
        SELECT email, name, total_messages, total_files_shared
        FROM people_stats
        WHERE workspace_id = ? AND email IN (${authorEmails.map(() => '?').join(',')})
        ORDER BY total_messages DESC
        LIMIT 5
      `).bind(user.workspace_id, ...authorEmails).all()
      peopleStats = peopleResult.results || []
    }

    // 6. Build timeline from results
    const timeline = combinedResults
      .filter(r => r.created_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(r => ({
        date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        event: r.title || r.content.slice(0, 50) + '...',
        source: r.source,
      }))

    // 7. Use Claude to synthesize an answer
    let answer = 'No relevant information found.'

    if (combinedResults.length > 0) {
      // Get workspace Claude API key
      const workspace = await c.env.DB.prepare(
        'SELECT claude_api_key_encrypted FROM workspaces WHERE id = ?'
      ).bind(user.workspace_id).first<{ claude_api_key_encrypted?: string }>()

      if (workspace?.claude_api_key_encrypted) {
        // Decrypt API key
        const { decrypt } = await import('../utils/encryption')
        const apiKey = await decrypt(workspace.claude_api_key_encrypted, c.env.ENCRYPTION_KEY)

        // Build context from results
        const context = combinedResults.map(r => {
          let text = ''
          if (r.title) text += `Title: ${r.title}\n`
          text += `Source: ${r.source} (${r.author_name || 'Unknown'})\n`
          text += `Date: ${r.created_at}\n`
          text += `Content: ${r.content.slice(0, 500)}\n`
          return text
        }).join('\n---\n')

        // Call Claude
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: `Based on the following information from the workspace, answer this question concisely: "${query}"

Context from indexed sources:
${context}

Provide a direct, helpful answer. Mention key people and dates if relevant. Keep it under 3 sentences.`,
            }],
          }),
        })

        const claudeData = await claudeResponse.json() as any
        if (claudeData.content?.[0]?.text) {
          answer = claudeData.content[0].text
        }
      } else {
        // No API key - generate a simple summary
        answer = `Found ${combinedResults.length} relevant items. The most recent is from ${combinedResults[0]?.author_name || 'unknown'} on ${new Date(combinedResults[0]?.created_at).toLocaleDateString()}.`
      }
    }

    // 8. Save query to history
    await c.env.DB.prepare(`
      INSERT INTO query_history (id, workspace_id, user_id, query, results_count, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(crypto.randomUUID(), user.workspace_id, user.id, query, combinedResults.length).run()

    // 9. Return results
    return c.json({
      answer,
      context: {
        people: peopleStats.map(p => ({
          name: p.name || p.email,
          email: p.email,
          messageCount: p.total_messages || 0,
          filesShared: p.total_files_shared || 0,
        })),
        timeline,
      },
      sources: combinedResults.map(r => ({
        id: r.id,
        title: r.title || r.file_name || r.content.slice(0, 50) + '...',
        snippet: r.content.slice(0, 150),
        source: r.source,
        url: r.source_url || '#',
        author: r.author_name,
        date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })),
    })
  } catch (err) {
    console.error('Search error:', err)
    return c.json({ error: 'Search failed' }, 500)
  }
})

// Get search suggestions
search.get('/suggestions', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  // Get popular/recent queries
  const result = await c.env.DB.prepare(`
    SELECT query, COUNT(*) as count
    FROM query_history
    WHERE workspace_id = ?
    GROUP BY query
    ORDER BY count DESC, MAX(created_at) DESC
    LIMIT 10
  `).bind(user.workspace_id).all<{ query: string; count: number }>()

  return c.json({ suggestions: result.results?.map(r => r.query) || [] })
})

// Get recent queries for current user
search.get('/recent', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const result = await c.env.DB.prepare(`
    SELECT query, created_at
    FROM query_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(user.id).all<{ query: string; created_at: string }>()

  return c.json({ queries: result.results || [] })
})

export default search
