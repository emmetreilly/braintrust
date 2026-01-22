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

// Get workspace's API key (preferred)
async function getWorkspaceApiKey(
  db: D1Database,
  groupId: string,
  jwtSecret: string
): Promise<string | null> {
  // First try to get workspace_id from the group
  const groupRow = await db.prepare(
    'SELECT workspace_id FROM groups WHERE id = ?'
  )
    .bind(groupId)
    .first()

  console.log('getWorkspaceApiKey - groupId:', groupId, 'workspace_id:', groupRow?.workspace_id)

  if (groupRow?.workspace_id) {
    const workspaceRow = await db.prepare(
      'SELECT claude_api_key_encrypted FROM workspaces WHERE id = ?'
    )
      .bind(groupRow.workspace_id)
      .first()

    console.log('getWorkspaceApiKey - workspace has key:', !!workspaceRow?.claude_api_key_encrypted)

    if (workspaceRow?.claude_api_key_encrypted) {
      try {
        const decrypted = decryptApiKey(workspaceRow.claude_api_key_encrypted as string, jwtSecret)
        console.log('getWorkspaceApiKey - decrypted key starts with:', decrypted?.substring(0, 10))
        return decrypted
      } catch (err) {
        console.error('getWorkspaceApiKey - decryption failed:', err)
      }
    }
  }

  // Fallback to group's API key (legacy)
  const row = await db.prepare(
    'SELECT claude_api_key_encrypted FROM groups WHERE id = ?'
  )
    .bind(groupId)
    .first()

  console.log('getWorkspaceApiKey - fallback to group key:', !!row?.claude_api_key_encrypted)

  if (!row?.claude_api_key_encrypted) return null
  return decryptApiKey(row.claude_api_key_encrypted as string, jwtSecret)
}

// Get user's API key for a provider (fallback if group doesn't have one)
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

// Get API key - prioritize workspace's key, fallback to group's, then user's
async function getApiKey(
  db: D1Database,
  groupId: string,
  userId: string,
  provider: AIProvider,
  jwtSecret: string
): Promise<string | null> {
  // First try workspace/group's API key
  const workspaceKey = await getWorkspaceApiKey(db, groupId, jwtSecret)
  if (workspaceKey) return workspaceKey

  // Fallback to user's personal key
  return getUserApiKey(db, userId, provider, jwtSecret)
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

// Get recent messages for context (including who said what)
async function getRecentMessages(db: D1Database, groupId: string, limit: number = 20): Promise<{ content: string; userName: string; type: string }[]> {
  const rows = await db.prepare(`
    SELECT m.content, m.type, u.name as user_name
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ? AND m.type IN ('text', 'brain_response')
    ORDER BY m.created_at DESC
    LIMIT ?
  `)
    .bind(groupId, limit)
    .all()

  return (rows.results || []).map((r: any) => ({
    content: r.content,
    userName: r.user_name || 'Brain',
    type: r.type,
  })).reverse()
}

// Get workspace-level reference documents (apply to ALL channels)
async function getWorkspaceReferenceDocuments(
  db: D1Database,
  workspaceId: string
): Promise<{ filename: string; content: string }[]> {
  const rows = await db.prepare(`
    SELECT id, filename, content_text
    FROM workspace_reference_docs
    WHERE workspace_id = ?
    ORDER BY filename
  `)
    .bind(workspaceId)
    .all()

  return (rows.results || []).map((row: any) => ({
    filename: row.filename as string,
    content: (row.content_text as string).slice(0, 20000),
  }))
}

// Get channel-level reference documents (specific to this channel)
async function getChannelReferenceDocuments(
  db: D1Database,
  r2Bucket: R2Bucket,
  groupId: string,
  workspaceId: string
): Promise<{ filename: string; content: string }[]> {
  // Get documents that are marked as reference AND shared to this channel
  const rows = await db.prepare(`
    SELECT DISTINCT d.id, d.filename, d.content_text, d.r2_key
    FROM documents d
    JOIN messages m ON m.group_id = ? AND m.type = 'media' AND m.deleted_at IS NULL
    WHERE d.workspace_id = ?
      AND d.is_reference = 1
      AND json_extract(m.media_data, '$.documentId') = d.id
    ORDER BY d.filename
  `)
    .bind(groupId, workspaceId)
    .all()

  const documents: { filename: string; content: string }[] = []

  for (const row of (rows.results || [])) {
    let content = row.content_text as string

    // Try R2 if no cached content
    if (!content && row.r2_key) {
      try {
        const object = await r2Bucket.get(row.r2_key as string)
        if (object) {
          const text = await object.text()
          if (text && !text.includes('\0') && text.length < 100000) {
            content = text
            // Cache for future
            await db.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
              .bind(content.slice(0, 50000), row.id)
              .run()
          }
        }
      } catch (e) {
        console.error('Failed to read reference doc from R2:', e)
      }
    }

    if (content) {
      documents.push({
        filename: row.filename as string,
        content: content.slice(0, 20000), // Reasonable limit per doc
      })
    }
  }

  return documents
}

// Get all reference documents (workspace + channel level)
async function getReferenceDocuments(
  db: D1Database,
  r2Bucket: R2Bucket,
  groupId: string,
  workspaceId: string
): Promise<{ filename: string; content: string; level: 'workspace' | 'channel' }[]> {
  const [workspaceDocs, channelDocs] = await Promise.all([
    getWorkspaceReferenceDocuments(db, workspaceId),
    getChannelReferenceDocuments(db, r2Bucket, groupId, workspaceId),
  ])

  return [
    ...workspaceDocs.map(d => ({ ...d, level: 'workspace' as const })),
    ...channelDocs.map(d => ({ ...d, level: 'channel' as const })),
  ]
}

// Get recently shared documents in the group chat
async function getRecentDocuments(db: D1Database, r2Bucket: R2Bucket, groupId: string, limit: number = 5): Promise<{ filename: string; content: string; uploadedBy: string }[]> {
  // Get messages with file attachments
  const rows = await db.prepare(`
    SELECT m.media_data, m.content, u.name as user_name
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ? AND m.type = 'media' AND m.media_data IS NOT NULL
    ORDER BY m.created_at DESC
    LIMIT ?
  `)
    .bind(groupId, limit)
    .all()

  const documents: { filename: string; content: string; uploadedBy: string }[] = []

  for (const row of (rows.results || [])) {
    try {
      const mediaData = JSON.parse(row.media_data as string)

      // Handle file attachments
      if (mediaData.type === 'file' && mediaData.documentId) {
        const doc = await db.prepare('SELECT filename, content_text, r2_key FROM documents WHERE id = ?')
          .bind(mediaData.documentId)
          .first()

        if (doc) {
          let content = doc.content_text as string

          // If no extracted text, try to get from R2 (for text files)
          if (!content && doc.r2_key) {
            try {
              const object = await r2Bucket.get(doc.r2_key as string)
              if (object) {
                const text = await object.text()
                // Only use if it looks like text (not binary)
                if (text && !text.includes('\0') && text.length < 50000) {
                  content = text
                }
              }
            } catch (e) {
              // Couldn't read file
            }
          }

          if (content) {
            documents.push({
              filename: doc.filename as string,
              content: content.slice(0, 10000), // Limit content size
              uploadedBy: row.user_name as string || 'Someone',
            })
          }
        }
      }

      // Handle claude_document shares
      if (mediaData.type === 'claude_document' && mediaData.documentId) {
        const doc = await db.prepare('SELECT title, conversation_history FROM claude_documents WHERE id = ?')
          .bind(mediaData.documentId)
          .first()

        if (doc) {
          const history = JSON.parse(doc.conversation_history as string)
          const summary = history.map((h: any) => `${h.role}: ${h.content}`).join('\n\n')
          documents.push({
            filename: doc.title as string,
            content: summary.slice(0, 10000),
            uploadedBy: row.user_name as string || 'Someone',
          })
        }
      }
    } catch (e) {
      // Skip invalid media data
    }
  }

  return documents
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

    // Get group info including workspace_id for debugging
    const group = await c.env.DB.prepare(
      'SELECT name, preferred_provider, workspace_id FROM groups WHERE id = ?'
    )
      .bind(groupId)
      .first()

    if (!group) {
      return c.json({ message: 'Group not found' }, 404)
    }

    console.log('Brain respond - group:', groupId, 'workspace_id:', group.workspace_id)

    const provider = (group.preferred_provider as AIProvider) || 'claude'

    // Try to get API key (workspace's key first, then group's, then user's)
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

    console.log('Brain respond - apiKey found:', !!apiKey, 'length:', apiKey?.length || 0)

    // Get recent messages for context (now includes who said what)
    const recentMessages = await getRecentMessages(c.env.DB, groupId)

    // Get recently shared documents
    const recentDocuments = await getRecentDocuments(c.env.DB, c.env.R2_BUCKET, groupId)

    // Get reference documents (always loaded into context)
    let referenceContext = ''
    if (group.workspace_id) {
      const referenceDocs = await getReferenceDocuments(
        c.env.DB,
        c.env.R2_BUCKET,
        groupId,
        group.workspace_id as string
      )
      if (referenceDocs.length > 0) {
        referenceContext = '\n\nCHANNEL REFERENCE DOCUMENTS (use these as rules/templates/guidelines):\n' +
          referenceDocs.map(doc =>
            `=== ${doc.filename} ===\n${doc.content}\n=== end of ${doc.filename} ===`
          ).join('\n\n')
        console.log('Brain respond - loaded', referenceDocs.length, 'reference docs')
      }
    }

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

    // Build document context
    let documentContext = ''
    if (recentDocuments.length > 0) {
      documentContext = '\n\nRECENTLY SHARED DOCUMENTS:\n' + recentDocuments.map(doc =>
        `--- ${doc.filename} (shared by ${doc.uploadedBy}) ---\n${doc.content}\n--- end of ${doc.filename} ---`
      ).join('\n\n')
    }

    // Get current user's org profile for personalized responses
    let userOrgContext = ''
    if (group.workspace_id) {
      const orgProfile = await c.env.DB.prepare(`
        SELECT name, title, department, reports_to_email, level, alignment, job_description, responsibilities, kpis
        FROM org_profiles WHERE user_id = ?
      `)
        .bind(user.id)
        .first()

      if (orgProfile) {
        userOrgContext = `\n\nCURRENT USER'S ROLE IN THE ORGANIZATION:
Name: ${orgProfile.name}
Title: ${orgProfile.title || 'N/A'}
Department: ${orgProfile.department || 'N/A'}
Reports To: ${orgProfile.reports_to_email || 'N/A'}
Level: ${orgProfile.level || 'N/A'}
Strategic Alignment: ${orgProfile.alignment || 'N/A'}
Job Description: ${orgProfile.job_description || 'N/A'}
Core Responsibilities: ${orgProfile.responsibilities || 'N/A'}
KPIs: ${orgProfile.kpis || 'N/A'}

Use this information to personalize your responses - help them with tasks relevant to their role,
understand what they're accountable for, and provide context-aware assistance.`
      }
    }

    // Build system prompt with reference docs, RAG context, document context, and user org context
    const systemPrompt = getBrainSystemPrompt({
      groupName: group.name as string,
      interests: [],
      recentTopics: recentMessages.slice(-5).map(m => `${m.userName}: ${m.content}`),
      ragContext: referenceContext + ragContext + documentContext + userOrgContext,
    })

    // Build conversation history with attribution
    const conversationHistory = recentMessages.map(msg => ({
      role: (msg.type === 'brain_response' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: msg.type === 'brain_response' ? msg.content : `[${msg.userName}]: ${msg.content}`,
    }))

    // Call AI
    const response = await callAI(
      provider,
      apiKey,
      systemPrompt,
      [
        ...conversationHistory,
        { role: 'user' as const, content: `[CURRENT USER - ${user.name}]: ${content}` },
      ]
    )

    // Save Brain's response as a message (private to requesting user by default)
    const brainMessageId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const brainUserId = 'brain-system'

    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, ai_provider, visible_to, created_at)
      VALUES (?, ?, ?, 'brain_response', ?, ?, ?, ?)
    `)
      .bind(brainMessageId, groupId, brainUserId, response.content, response.provider, user.id, createdAt)
      .run()

    return c.json({
      message: {
        id: brainMessageId,
        group_id: groupId,
        user_id: brainUserId,
        type: 'brain_response',
        content: response.content,
        ai_provider: response.provider,
        visible_to: user.id, // Private to this user until shared
        created_at: createdAt,
      },
    })
  } catch (error) {
    console.error('Brain respond error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ message: `Brain encountered an error: ${errorMessage}` }, 500)
  }
})

// Share a private Brain response with the group
brain.post('/share/:messageId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const messageId = c.req.param('messageId')

  try {
    // Get the message and verify ownership
    const msg = await c.env.DB.prepare(
      'SELECT * FROM messages WHERE id = ? AND visible_to = ?'
    )
      .bind(messageId, user.id)
      .first()

    if (!msg) {
      return c.json({ message: 'Message not found or already shared' }, 404)
    }

    // Make it visible to everyone by setting visible_to to null
    await c.env.DB.prepare(
      'UPDATE messages SET visible_to = NULL WHERE id = ?'
    )
      .bind(messageId)
      .run()

    return c.json({
      success: true,
      message: {
        id: msg.id,
        group_id: msg.group_id,
        user_id: msg.user_id,
        type: msg.type,
        content: msg.content,
        visible_to: null, // Now visible to everyone
        created_at: msg.created_at,
      },
    })
  } catch (error) {
    console.error('Share message error:', error)
    return c.json({ message: 'Failed to share message' }, 500)
  }
})

// Public follow-up question on a shared insight
brain.post('/followup', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, parentMessageId, question } = await c.req.json<{
      groupId: string
      parentMessageId: string
      question: string
    }>()

    if (!question?.trim()) {
      return c.json({ message: 'Question is required' }, 400)
    }

    // Get the parent message (the insight being replied to)
    const parentMsg = await c.env.DB.prepare(
      'SELECT id, content, media_data, type FROM messages WHERE id = ? AND group_id = ?'
    )
      .bind(parentMessageId, groupId)
      .first()

    if (!parentMsg) {
      return c.json({ message: 'Parent message not found' }, 404)
    }

    // Extract documentId from parent's media_data if present
    let documentId: string | undefined
    let documentName: string | undefined
    if (parentMsg.media_data) {
      try {
        const mediaData = JSON.parse(parentMsg.media_data as string)
        if (mediaData.documentId) {
          documentId = mediaData.documentId
          documentName = mediaData.documentName
        }
      } catch { /* ignore */ }
    }

    // Fetch document content if documentId exists
    let documentContext = ''
    if (documentId) {
      const doc = await c.env.DB.prepare('SELECT filename, content_text, r2_key FROM documents WHERE id = ?')
        .bind(documentId)
        .first()

      if (doc) {
        let content = doc.content_text as string

        // Try R2 if no cached content
        if (!content && doc.r2_key) {
          try {
            const object = await c.env.R2_BUCKET.get(doc.r2_key as string)
            if (object) {
              const text = await object.text()
              if (text && !text.includes('\0') && text.length < 100000) {
                content = text
                // Cache for future
                await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
                  .bind(content.slice(0, 50000), documentId)
                  .run()
              }
            }
          } catch (e) {
            console.error('Failed to read document from R2:', e)
          }
        }

        if (content) {
          documentContext = `\n\nDOCUMENT CONTENT ("${doc.filename}"):\n--- START OF DOCUMENT ---\n${content.slice(0, 50000)}\n--- END OF DOCUMENT ---`
        }
      }
    }

    // Get previous replies in this thread for context
    const threadReplies = await c.env.DB.prepare(`
      SELECT content, user_id, type FROM messages
      WHERE parent_message_id = ?
      ORDER BY created_at ASC
      LIMIT 20
    `)
      .bind(parentMessageId)
      .all()

    // Build conversation history from thread
    const threadHistory = (threadReplies.results || []).map((r: any) => ({
      role: r.type === 'brain_response' ? 'assistant' : 'user',
      content: r.content,
    }))

    // Get API key and provider
    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

    // Get group info for reference docs
    const group = await c.env.DB.prepare('SELECT workspace_id FROM groups WHERE id = ?')
      .bind(groupId)
      .first()

    // Get reference documents (always loaded into context)
    let referenceContext = ''
    if (group?.workspace_id) {
      const referenceDocs = await getReferenceDocuments(
        c.env.DB,
        c.env.R2_BUCKET,
        groupId,
        group.workspace_id as string
      )
      if (referenceDocs.length > 0) {
        referenceContext = '\n\nCHANNEL REFERENCE DOCUMENTS (use these as rules/templates/guidelines):\n' +
          referenceDocs.map(doc =>
            `=== ${doc.filename} ===\n${doc.content}\n=== end of ${doc.filename} ===`
          ).join('\n\n')
      }
    }

    // Build system prompt
    const systemPrompt = `You are Brain, an AI assistant helping a work team. You're responding to a follow-up question about a shared insight.
${referenceContext}

ORIGINAL INSIGHT:
${parentMsg.content}
${documentContext}

You're now answering follow-up questions from the team. Be helpful, concise, and reference the document content when relevant. Follow any guidelines from the channel reference documents. Keep responses focused and actionable.`

    // Build messages
    const messages = [
      ...threadHistory.map((h: any) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: `[CURRENT USER - ${user.name}]: ${question.trim()}` },
    ]

    // Call AI
    const response = await callAI(provider, apiKey, systemPrompt, messages)

    // Save user's question as a public message
    const questionId = crypto.randomUUID()
    const questionCreatedAt = new Date().toISOString()
    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, parent_message_id, created_at)
      VALUES (?, ?, ?, 'text', ?, ?, ?)
    `)
      .bind(questionId, groupId, user.id, question.trim(), parentMessageId, questionCreatedAt)
      .run()

    // Save Brain's response as a public message
    const responseId = crypto.randomUUID()
    const responseCreatedAt = new Date().toISOString()
    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, ai_provider, parent_message_id, created_at)
      VALUES (?, ?, ?, 'brain_response', ?, ?, ?, ?)
    `)
      .bind(responseId, groupId, 'brain-system', response.content, response.provider, parentMessageId, responseCreatedAt)
      .run()

    // Return both messages for the frontend
    return c.json({
      questionMessage: {
        id: questionId,
        group_id: groupId,
        user_id: user.id,
        type: 'text',
        content: question.trim(),
        parent_message_id: parentMessageId,
        created_at: questionCreatedAt,
        author: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
      responseMessage: {
        id: responseId,
        group_id: groupId,
        user_id: 'brain-system',
        type: 'brain_response',
        content: response.content,
        ai_provider: response.provider,
        parent_message_id: parentMessageId,
        created_at: responseCreatedAt,
      },
    })
  } catch (error) {
    console.error('Followup error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ message: `Brain encountered an error: ${errorMessage}` }, 500)
  }
})

// Handle private thread message
brain.post('/private', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, message, context, history, documentId } = await c.req.json<{
      groupId: string
      message: string
      context?: string
      history?: { role: string; content: string }[]
      documentId?: string
    }>()

    // Get group info
    const group = await c.env.DB.prepare('SELECT workspace_id FROM groups WHERE id = ?')
      .bind(groupId)
      .first()

    // Get group provider
    const provider = await getGroupProvider(c.env.DB, groupId)

    // Try to get API key (group's key first, then user's)
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

    // Get reference documents (always loaded into context)
    let referenceContext = ''
    if (group?.workspace_id) {
      const referenceDocs = await getReferenceDocuments(
        c.env.DB,
        c.env.R2_BUCKET,
        groupId,
        group.workspace_id as string
      )
      if (referenceDocs.length > 0) {
        referenceContext = '\n\nCHANNEL REFERENCE DOCUMENTS (use these as rules/templates/guidelines):\n' +
          referenceDocs.map(doc =>
            `=== ${doc.filename} ===\n${doc.content}\n=== end of ${doc.filename} ===`
          ).join('\n\n')
      }
    }

    // If documentId provided, fetch the document content
    let documentContext = ''
    if (documentId) {
      console.log('Private thread - fetching document:', documentId)

      const doc = await c.env.DB.prepare('SELECT filename, content_text, r2_key, file_type, mime_type FROM documents WHERE id = ?')
        .bind(documentId)
        .first()

      console.log('Private thread - document found:', !!doc, 'filename:', doc?.filename, 'has_content_text:', !!doc?.content_text, 'r2_key:', doc?.r2_key)

      if (doc) {
        let content = doc.content_text as string

        // If no extracted text, try to get from R2
        if (!content && doc.r2_key) {
          console.log('Private thread - fetching from R2:', doc.r2_key)
          try {
            const object = await c.env.R2_BUCKET.get(doc.r2_key as string)
            console.log('Private thread - R2 object found:', !!object)
            if (object) {
              const text = await object.text()
              console.log('Private thread - R2 text length:', text?.length, 'first 100 chars:', text?.slice(0, 100))
              // Only use if it looks like text (not binary)
              if (text && !text.includes('\0') && text.length < 100000) {
                content = text

                // Save content_text for future use
                await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
                  .bind(content.slice(0, 50000), documentId)
                  .run()
                console.log('Private thread - saved content_text to DB')
              }
            }
          } catch (e) {
            console.error('Failed to read document from R2:', e)
          }
        }

        if (content) {
          console.log('Private thread - document content length:', content.length)
          documentContext = `\n\nDOCUMENT CONTENT ("${doc.filename}"):\n--- START OF DOCUMENT ---\n${content.slice(0, 50000)}\n--- END OF DOCUMENT ---\n\nThe user is asking about this document. Use the document content above to answer their questions accurately.`
        } else {
          console.log('Private thread - NO content found for document')
        }
      } else {
        console.log('Private thread - document NOT found in DB')
      }
    }

    // Build system prompt with reference docs and document context
    const fullContext = [referenceContext, context, documentContext].filter(Boolean).join('\n')
    const systemPrompt = getPrivateSystemPrompt({
      userName: user.name,
      contextMessage: fullContext || undefined,
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

// === PERSISTENT PRIVATE THREADS ===

// Get or create a persistent private thread for a user in a channel
brain.get('/private-thread/:groupId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')
  const documentId = c.req.query('documentId') || null

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

    // Find existing thread (match on user, group, and optionally document)
    let thread = await c.env.DB.prepare(`
      SELECT id, document_id, document_name, created_at, updated_at
      FROM private_threads
      WHERE user_id = ? AND group_id = ? AND (document_id = ? OR (document_id IS NULL AND ? IS NULL))
      ORDER BY updated_at DESC
      LIMIT 1
    `)
      .bind(user.id, groupId, documentId, documentId)
      .first()

    // If no thread exists, return empty (frontend will create on first message)
    if (!thread) {
      return c.json({
        thread: null,
        messages: []
      })
    }

    // Get messages for this thread
    const messagesResult = await c.env.DB.prepare(`
      SELECT id, role, content, created_at
      FROM private_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `)
      .bind(thread.id)
      .all()

    return c.json({
      thread: {
        id: thread.id,
        documentId: thread.document_id,
        documentName: thread.document_name,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      },
      messages: (messagesResult.results || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
    })
  } catch (error) {
    console.error('Get private thread error:', error)
    return c.json({ message: 'Failed to get private thread' }, 500)
  }
})

// Send a message in a persistent private thread
brain.post('/private-thread/:groupId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')

  try {
    const { message, documentId, documentName, context } = await c.req.json<{
      message: string
      documentId?: string
      documentName?: string
      context?: string
    }>()

    if (!message?.trim()) {
      return c.json({ message: 'Message is required' }, 400)
    }

    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    // Find or create thread
    let thread = await c.env.DB.prepare(`
      SELECT id FROM private_threads
      WHERE user_id = ? AND group_id = ? AND (document_id = ? OR (document_id IS NULL AND ? IS NULL))
    `)
      .bind(user.id, groupId, documentId || null, documentId || null)
      .first()

    const now = new Date().toISOString()

    if (!thread) {
      // Create new thread
      const threadId = crypto.randomUUID()
      await c.env.DB.prepare(`
        INSERT INTO private_threads (id, user_id, group_id, document_id, document_name, context_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(threadId, user.id, groupId, documentId || null, documentName || null, context || null, now, now)
        .run()
      thread = { id: threadId }
    } else {
      // Update timestamp
      await c.env.DB.prepare('UPDATE private_threads SET updated_at = ? WHERE id = ?')
        .bind(now, thread.id)
        .run()
    }

    // Get existing messages for context
    const existingMessages = await c.env.DB.prepare(`
      SELECT role, content FROM private_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `)
      .bind(thread.id)
      .all()

    const history = (existingMessages.results || []).map((m: any) => ({
      role: m.role,
      content: m.content,
    }))

    // Save user message
    const userMsgId = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO private_messages (id, thread_id, role, content, created_at)
      VALUES (?, ?, 'user', ?, ?)
    `)
      .bind(userMsgId, thread.id, message, now)
      .run()

    // Get group info for reference docs
    const group = await c.env.DB.prepare('SELECT workspace_id FROM groups WHERE id = ?')
      .bind(groupId)
      .first()

    // Get group provider and API key
    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

    // Get reference documents
    let referenceContext = ''
    if (group?.workspace_id) {
      const referenceDocs = await getReferenceDocuments(
        c.env.DB,
        c.env.R2_BUCKET,
        groupId,
        group.workspace_id as string
      )
      if (referenceDocs.length > 0) {
        referenceContext = '\n\nCHANNEL REFERENCE DOCUMENTS (use these as rules/templates/guidelines):\n' +
          referenceDocs.map(doc =>
            `=== ${doc.filename} ===\n${doc.content}\n=== end of ${doc.filename} ===`
          ).join('\n\n')
      }
    }

    // Get list of available documents in the channel (just names, not full content)
    // This tells Brain what files exist without overwhelming context
    const recentDocuments = await getRecentDocuments(c.env.DB, c.env.R2_BUCKET, groupId, 10)
    let channelDocsContext = ''
    if (recentDocuments.length > 0 && !documentId) {
      // Only show doc list when NOT focused on a specific document
      // Don't include full content - just names so Brain knows what's available
      channelDocsContext = '\n\nDOCUMENTS AVAILABLE IN THIS CHANNEL:\n' +
        recentDocuments.map(doc => `- "${doc.filename}" (shared by ${doc.uploadedBy})`).join('\n') +
        '\n\nIf the user asks about a specific document, let them know they can click "Ask Brain" on that file for detailed analysis.'
    }

    // Get document content if documentId provided (for focused document conversation)
    let documentContext = ''
    console.log('Private thread - documentId:', documentId, 'apiKey exists:', !!apiKey)
    if (documentId) {
      const doc = await c.env.DB.prepare('SELECT filename, content_text, r2_key, file_type, mime_type FROM documents WHERE id = ?')
        .bind(documentId)
        .first()
      console.log('Private thread - doc found:', !!doc, 'filename:', doc?.filename, 'has content_text:', !!doc?.content_text, 'r2_key:', doc?.r2_key)

      if (doc) {
        let content = doc.content_text as string

        if (!content && doc.r2_key) {
          console.log('Private thread - no content_text, fetching from R2...')
          try {
            const object = await c.env.R2_BUCKET.get(doc.r2_key as string)
            console.log('Private thread - R2 object found:', !!object, 'size:', object?.size)
            if (object) {
              // Check if it's a document that needs Claude extraction (PDF, DOCX, etc.)
              const filename = doc.filename as string
              const isDocx = doc.file_type === 'doc' || (doc.mime_type as string)?.includes('word') || filename?.endsWith('.docx') || filename?.endsWith('.doc')
              const isPdf = doc.file_type === 'pdf' || doc.mime_type === 'application/pdf'
              const isSpreadsheet = doc.file_type === 'spreadsheet' || (doc.mime_type as string)?.includes('sheet') || (doc.mime_type as string)?.includes('excel') || filename?.endsWith('.xlsx') || filename?.endsWith('.xls') || filename?.endsWith('.csv')
              const isPpt = (doc.mime_type as string)?.includes('presentation') || (doc.mime_type as string)?.includes('powerpoint') || filename?.endsWith('.pptx') || filename?.endsWith('.ppt')

              console.log('Private thread - isDocx:', isDocx, 'isPdf:', isPdf, 'file_type:', doc.file_type, 'mime_type:', doc.mime_type)

              if (isPdf || isDocx || isSpreadsheet || isPpt) {
                // Use Claude to extract text from binary documents (on-demand extraction)
                console.log('Private thread - needs Claude extraction, apiKey exists:', !!apiKey)
                if (apiKey) {
                  const arrayBuffer = await object.arrayBuffer()
                  // Use chunked encoding to avoid call stack overflow with large files
                  const bytes = new Uint8Array(arrayBuffer)
                  let base64 = ''
                  const chunkSize = 32768 // 32KB chunks
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                    const chunk = bytes.slice(i, i + chunkSize)
                    base64 += String.fromCharCode.apply(null, Array.from(chunk))
                  }
                  base64 = btoa(base64)

                  // Determine media type
                  let mediaType = 'application/octet-stream'
                  if (isPdf) mediaType = 'application/pdf'
                  else if (isDocx) mediaType = filename?.endsWith('.doc') ? 'application/msword' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  else if (isSpreadsheet) {
                    if (filename?.endsWith('.csv')) mediaType = 'text/csv'
                    else if (filename?.endsWith('.xls')) mediaType = 'application/vnd.ms-excel'
                    else mediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  }
                  else if (isPpt) {
                    if (filename?.endsWith('.ppt')) mediaType = 'application/vnd.ms-powerpoint'
                    else mediaType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                  }

                  console.log('Private thread - extracting text from document:', filename, 'mediaType:', mediaType)

                  const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-api-key': apiKey,
                      'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                      model: 'claude-sonnet-4-20250514',
                      max_tokens: 8192,
                      messages: [{
                        role: 'user',
                        content: [
                          {
                            type: 'document',
                            source: {
                              type: 'base64',
                              media_type: mediaType,
                              data: base64,
                            },
                          },
                          {
                            type: 'text',
                            text: 'Please extract ALL the text content from this document. Include everything - headings, body text, lists, tables. Format it clearly with markdown.',
                          },
                        ],
                      }],
                    }),
                  })

                  if (response.ok) {
                    const data = await response.json() as { content: Array<{ type: string; text: string }> }
                    content = data.content[0]?.text || null

                    // Cache extracted content for future use
                    if (content) {
                      await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
                        .bind(content.slice(0, 50000), documentId)
                        .run()
                      console.log('Private thread - cached extracted content, length:', content.length)
                    }
                  } else {
                    console.error('Private thread - Claude extraction failed:', await response.text())
                  }
                }
              } else {
                // Plain text file - read directly
                const text = await object.text()
                if (text && !text.includes('\0') && text.length < 100000) {
                  content = text
                  await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
                    .bind(content.slice(0, 50000), documentId)
                    .run()
                }
              }
            }
          } catch (e) {
            console.error('Failed to read document from R2:', e)
          }
        }

        if (content) {
          documentContext = `\n\nDOCUMENT CONTENT ("${doc.filename}"):\n--- START OF DOCUMENT ---\n${content.slice(0, 50000)}\n--- END OF DOCUMENT ---\n\nThe user is asking about this document.`
        } else {
          // No content available - let Brain know
          documentContext = `\n\nNOTE: The document "${doc.filename}" was uploaded but I couldn't extract its text content. The user may need to re-share it or upload a text version.`
        }
      }
    }

    // Build system prompt with all context layers
    const fullContext = [referenceContext, channelDocsContext, context, documentContext].filter(Boolean).join('\n')
    const systemPrompt = getPrivateSystemPrompt({
      userName: user.name,
      contextMessage: fullContext || undefined,
    })

    // Build messages for AI
    const aiMessages = [
      ...history.map((h: any) => ({
        role: (h.role === 'brain' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message },
    ]

    // Call AI
    const response = await callAI(provider, apiKey, systemPrompt, aiMessages)

    // Save Brain response
    const brainMsgId = crypto.randomUUID()
    const brainNow = new Date().toISOString()
    await c.env.DB.prepare(`
      INSERT INTO private_messages (id, thread_id, role, content, ai_provider, created_at)
      VALUES (?, ?, 'brain', ?, ?, ?)
    `)
      .bind(brainMsgId, thread.id, response.content, response.provider, brainNow)
      .run()

    return c.json({
      threadId: thread.id,
      userMessage: {
        id: userMsgId,
        role: 'user',
        content: message,
        createdAt: now,
      },
      brainMessage: {
        id: brainMsgId,
        role: 'brain',
        content: response.content,
        createdAt: brainNow,
      },
    })
  } catch (error) {
    console.error('Private thread message error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ message: `Brain encountered an error: ${errorMessage}` }, 500)
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
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

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
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

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
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

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
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

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

// === CLAUDE DOCUMENTS ===

// Create a new document (start a conversation)
brain.post('/documents', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { groupId, title, initialPrompt } = await c.req.json<{
      groupId: string
      title: string
      initialPrompt: string
    }>()

    if (!title?.trim() || !initialPrompt?.trim()) {
      return c.json({ message: 'Title and initial prompt are required' }, 400)
    }

    const provider = await getGroupProvider(c.env.DB, groupId)
    const apiKey = await getApiKey(c.env.DB, groupId, user.id, provider, c.env.JWT_SECRET)

    // Get Claude's response
    const response = await callAI(
      provider,
      apiKey,
      'You are a helpful AI assistant for a work team. Be concise and helpful.',
      [{ role: 'user', content: initialPrompt }]
    )

    // Create conversation history
    const conversationHistory = [
      { role: 'user', content: initialPrompt, timestamp: new Date().toISOString(), userId: user.id },
      { role: 'assistant', content: response.content, timestamp: new Date().toISOString() },
    ]

    // Save document
    const docId = crypto.randomUUID()
    const now = new Date().toISOString()

    await c.env.DB.prepare(`
      INSERT INTO claude_documents (id, group_id, created_by, title, conversation_history, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(docId, groupId, user.id, title.trim(), JSON.stringify(conversationHistory), now, now)
      .run()

    return c.json({
      document: {
        id: docId,
        group_id: groupId,
        created_by: user.id,
        title: title.trim(),
        conversation_history: conversationHistory,
        is_shared: false,
        created_at: now,
        updated_at: now,
      },
    })
  } catch (error) {
    console.error('Create document error:', error)
    return c.json({ message: 'Failed to create document' }, 500)
  }
})

// Get a document
brain.get('/documents/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const doc = await c.env.DB.prepare(`
      SELECT d.*, u.name as creator_name
      FROM claude_documents d
      JOIN users u ON d.created_by = u.id
      WHERE d.id = ?
    `)
      .bind(docId)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Check if user is in the group
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(doc.group_id, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Access denied' }, 403)
    }

    return c.json({
      document: {
        id: doc.id,
        group_id: doc.group_id,
        created_by: doc.created_by,
        creator_name: doc.creator_name,
        title: doc.title,
        conversation_history: JSON.parse(doc.conversation_history as string),
        is_shared: !!doc.is_shared,
        shared_at: doc.shared_at,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      },
    })
  } catch (error) {
    console.error('Get document error:', error)
    return c.json({ message: 'Failed to get document' }, 500)
  }
})

// Continue a document conversation
brain.post('/documents/:id/continue', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const { message } = await c.req.json<{ message: string }>()

    if (!message?.trim()) {
      return c.json({ message: 'Message is required' }, 400)
    }

    // Get document
    const doc = await c.env.DB.prepare(
      'SELECT * FROM claude_documents WHERE id = ?'
    )
      .bind(docId)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(doc.group_id, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Access denied' }, 403)
    }

    const provider = await getGroupProvider(c.env.DB, doc.group_id as string)
    const apiKey = await getApiKey(c.env.DB, doc.group_id as string, user.id, provider, c.env.JWT_SECRET)

    // Parse existing history
    const conversationHistory = JSON.parse(doc.conversation_history as string)

    // Build messages for AI
    const aiMessages = conversationHistory.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }))
    aiMessages.push({ role: 'user', content: message })

    // Get response
    const response = await callAI(
      provider,
      apiKey,
      'You are a helpful AI assistant for a work team. Be concise and helpful.',
      aiMessages
    )

    // Add to history
    const now = new Date().toISOString()
    conversationHistory.push({ role: 'user', content: message, timestamp: now, userId: user.id })
    conversationHistory.push({ role: 'assistant', content: response.content, timestamp: now })

    // Update document
    await c.env.DB.prepare(`
      UPDATE claude_documents SET conversation_history = ?, updated_at = ? WHERE id = ?
    `)
      .bind(JSON.stringify(conversationHistory), now, docId)
      .run()

    return c.json({
      response: response.content,
      conversation_history: conversationHistory,
    })
  } catch (error) {
    console.error('Continue document error:', error)
    return c.json({ message: 'Failed to continue conversation' }, 500)
  }
})

// Share a document to group chat
brain.post('/documents/:id/share', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const { shareMessage } = await c.req.json<{ shareMessage?: string }>()

    // Get document
    const doc = await c.env.DB.prepare(
      'SELECT * FROM claude_documents WHERE id = ?'
    )
      .bind(docId)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Check ownership or membership
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(doc.group_id, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Access denied' }, 403)
    }

    const now = new Date().toISOString()

    // Mark document as shared
    await c.env.DB.prepare(`
      UPDATE claude_documents SET is_shared = 1, shared_at = ? WHERE id = ?
    `)
      .bind(now, docId)
      .run()

    // Create a message in the group chat referencing this document
    const messageId = crypto.randomUUID()
    const messageContent = shareMessage || `Shared document: ${doc.title}`

    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, media_data, created_at)
      VALUES (?, ?, ?, 'media', ?, ?, ?)
    `)
      .bind(
        messageId,
        doc.group_id,
        user.id,
        messageContent,
        JSON.stringify({ type: 'claude_document', documentId: docId, title: doc.title }),
        now
      )
      .run()

    return c.json({
      success: true,
      message: {
        id: messageId,
        group_id: doc.group_id,
        user_id: user.id,
        type: 'media',
        content: messageContent,
        media_data: { type: 'claude_document', documentId: docId, title: doc.title },
        created_at: now,
      },
    })
  } catch (error) {
    console.error('Share document error:', error)
    return c.json({ message: 'Failed to share document' }, 500)
  }
})

// List documents for a group
brain.get('/documents', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.query('groupId')
  const sharedOnly = c.req.query('sharedOnly') === 'true'

  if (!groupId) {
    return c.json({ message: 'groupId is required' }, 400)
  }

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

    let query = `
      SELECT d.*, u.name as creator_name
      FROM claude_documents d
      JOIN users u ON d.created_by = u.id
      WHERE d.group_id = ?
    `
    if (sharedOnly) {
      query += ' AND d.is_shared = 1'
    }
    query += ' ORDER BY d.updated_at DESC LIMIT 50'

    const rows = await c.env.DB.prepare(query)
      .bind(groupId)
      .all()

    const documents = (rows.results || []).map((doc: any) => ({
      id: doc.id,
      group_id: doc.group_id,
      created_by: doc.created_by,
      creator_name: doc.creator_name,
      title: doc.title,
      is_shared: !!doc.is_shared,
      shared_at: doc.shared_at,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      // Don't include full conversation history in list view
      message_count: JSON.parse(doc.conversation_history).length,
    }))

    return c.json({ documents })
  } catch (error) {
    console.error('List documents error:', error)
    return c.json({ message: 'Failed to list documents' }, 500)
  }
})

export default brain
