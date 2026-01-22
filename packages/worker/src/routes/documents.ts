import { Hono } from 'hono'
import { verifyToken } from '../lib/auth'
import type { Env, User, Document, DocumentTag } from '../types'

const documents = new Hono<{ Bindings: Env }>()

// Middleware to get current user with workspace
async function getUser(c: any): Promise<(User & { workspace_id: string }) | null> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return null

  const row = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.avatar_url, u.interests, u.created_at, u.workspace_id, w.name as workspace_name
    FROM users u
    LEFT JOIN workspaces w ON u.workspace_id = w.id
    WHERE u.id = ?
  `)
    .bind(payload.sub)
    .first()

  if (!row || !row.workspace_id) return null

  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    avatar_url: (row.avatar_url as string) || undefined,
    interests: JSON.parse((row.interests as string) || '[]'),
    created_at: row.created_at as string,
    workspace_id: row.workspace_id as string,
    workspace_name: row.workspace_name as string,
  }
}

// Get file type from mime type
function getFileType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'doc'
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'spreadsheet'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation'
  if (mimeType.startsWith('text/')) return 'text'
  return 'other'
}

// List documents in workspace
documents.get('/', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const tagId = c.req.query('tag')
  const fileType = c.req.query('type')
  const search = c.req.query('search')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  try {
    let query = `
      SELECT d.*, u.name as uploader_name, u.email as uploader_email
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      WHERE d.workspace_id = ?
    `
    const params: any[] = [user.workspace_id]

    if (tagId) {
      query += ` AND d.id IN (SELECT document_id FROM document_tag_assignments WHERE tag_id = ?)`
      params.push(tagId)
    }

    if (fileType) {
      query += ` AND d.file_type = ?`
      params.push(fileType)
    }

    if (search) {
      query += ` AND (d.filename LIKE ? OR d.content_text LIKE ?)`
      params.push(`%${search}%`, `%${search}%`)
    }

    query += ` ORDER BY d.created_at DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const stmt = c.env.DB.prepare(query)
    const rows = await stmt.bind(...params).all()

    // Get tags for each document
    const docs = await Promise.all(
      (rows.results || []).map(async (row: any) => {
        const tagRows = await c.env.DB.prepare(`
          SELECT t.* FROM document_tags t
          JOIN document_tag_assignments a ON t.id = a.tag_id
          WHERE a.document_id = ?
        `)
          .bind(row.id)
          .all()

        return {
          id: row.id,
          workspace_id: row.workspace_id,
          uploaded_by: row.uploaded_by,
          filename: row.filename,
          file_type: row.file_type,
          mime_type: row.mime_type,
          file_size: row.file_size,
          r2_key: row.r2_key,
          has_embedding: !!row.has_embedding,
          is_reference: !!row.is_reference,
          created_at: row.created_at,
          uploader: {
            id: row.uploaded_by,
            name: row.uploader_name,
            email: row.uploader_email,
          },
          tags: (tagRows.results || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            tag_type: t.tag_type,
          })),
        }
      })
    )

    return c.json({ documents: docs })
  } catch (error) {
    console.error('List documents error:', error)
    return c.json({ message: 'Failed to list documents' }, 500)
  }
})

// Get documents shared to a specific group/channel
documents.get('/group/:groupId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')

  try {
    // Check if user is member of the group
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    // Find all documents that have been shared to this group via messages
    // Look for messages with media_data containing documentId
    const rows = await c.env.DB.prepare(`
      SELECT DISTINCT d.*, u.name as uploader_name, u.email as uploader_email
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      JOIN messages m ON m.group_id = ? AND m.type = 'media' AND m.deleted_at IS NULL
      WHERE d.workspace_id = ?
        AND json_extract(m.media_data, '$.documentId') = d.id
      ORDER BY d.created_at DESC
    `)
      .bind(groupId, user.workspace_id)
      .all()

    // Get tags for each document
    const docs = await Promise.all(
      (rows.results || []).map(async (row: any) => {
        const tagRows = await c.env.DB.prepare(`
          SELECT t.id, t.name, t.color, t.tag_type
          FROM document_tags t
          JOIN document_tag_assignments dta ON t.id = dta.tag_id
          WHERE dta.document_id = ?
        `)
          .bind(row.id)
          .all()

        return {
          id: row.id,
          workspace_id: row.workspace_id,
          uploaded_by: row.uploaded_by,
          filename: row.filename,
          file_type: row.file_type,
          mime_type: row.mime_type,
          file_size: row.file_size,
          r2_key: row.r2_key,
          has_embedding: !!row.has_embedding,
          is_reference: !!row.is_reference,
          created_at: row.created_at,
          uploader: {
            id: row.uploaded_by,
            name: row.uploader_name,
            email: row.uploader_email,
          },
          tags: (tagRows.results || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            tag_type: t.tag_type,
          })),
        }
      })
    )

    return c.json({ documents: docs })
  } catch (error) {
    console.error('List group documents error:', error)
    return c.json({ message: 'Failed to list group documents' }, 500)
  }
})

// Helper function to auto-tag a document using Claude
async function autoTagDocument(
  contentText: string,
  apiKey: string,
  filename: string
): Promise<{ client?: string; topic?: string; type?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Analyze this document and extract tags. Return ONLY a JSON object with these optional fields:
- "client": Company/client name if mentioned (e.g., "Acme Corp", "Nike")
- "topic": Main subject area (one of: sales, marketing, operations, legal, finance, hr, product, engineering, support, general)
- "type": Document type (one of: transcript, report, contract, proposal, notes, presentation, spreadsheet, email, article, other)

Filename: "${filename}"
Content (first 2000 chars):
${contentText.slice(0, 2000)}

Return ONLY valid JSON, no explanation:`,
        }],
      }),
    })

    if (response.ok) {
      const data = await response.json() as { content: Array<{ type: string; text: string }> }
      const text = data.content[0]?.text || '{}'
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    }
  } catch (e) {
    console.error('Auto-tag error:', e)
  }
  return {}
}

// Helper to find or create a tag
async function findOrCreateTag(
  db: any,
  workspaceId: string,
  name: string,
  tagType: 'client' | 'topic' | 'tag',
  color: string
): Promise<string> {
  // Check if tag exists
  const existing = await db.prepare(
    'SELECT id FROM document_tags WHERE workspace_id = ? AND name = ?'
  ).bind(workspaceId, name).first()

  if (existing) {
    return existing.id as string
  }

  // Create new tag
  const id = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO document_tags (id, workspace_id, name, color, tag_type) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, workspaceId, name, color, tagType).run()

  return id
}

// Upload document with extraction and auto-tagging
documents.post('/upload', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return c.json({ message: 'No file provided' }, 400)
    }

    const id = crypto.randomUUID()
    const r2Key = `${user.workspace_id}/${id}/${file.name}`
    const fileType = getFileType(file.type)
    const filename = file.name

    // Get file bytes for upload and potential extraction
    const fileArrayBuffer = await file.arrayBuffer()

    // Upload to R2
    await c.env.R2_BUCKET.put(r2Key, fileArrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        workspace_id: user.workspace_id,
        uploaded_by: user.id,
        original_filename: file.name,
      },
    })

    // Extract text based on file type
    let contentText: string | null = null
    const isDocx = fileType === 'doc' || file.type?.includes('word') || filename?.endsWith('.docx') || filename?.endsWith('.doc')
    const isPdf = fileType === 'pdf' || file.type === 'application/pdf'
    const isSpreadsheet = fileType === 'spreadsheet' || file.type?.includes('sheet') || file.type?.includes('excel') || filename?.endsWith('.xlsx') || filename?.endsWith('.xls') || filename?.endsWith('.csv')
    const isPpt = file.type?.includes('presentation') || file.type?.includes('powerpoint') || filename?.endsWith('.pptx') || filename?.endsWith('.ppt')
    const isText = fileType === 'text' || file.type === 'text/plain' || filename?.endsWith('.txt') || filename?.endsWith('.md')

    // Get workspace API key for extraction/tagging
    const workspaceRow = await c.env.DB.prepare(
      'SELECT claude_api_key_encrypted FROM workspaces WHERE id = ?'
    ).bind(user.workspace_id).first()

    let apiKey: string | null = null
    if (workspaceRow?.claude_api_key_encrypted) {
      const { decryptApiKey } = await import('../lib/auth')
      apiKey = decryptApiKey(workspaceRow.claude_api_key_encrypted as string, c.env.JWT_SECRET)
    }

    // Extract text on upload (not on-demand)
    if (isText) {
      // Plain text - read directly
      contentText = new TextDecoder().decode(fileArrayBuffer)
    } else if ((isPdf || isDocx || isSpreadsheet || isPpt) && apiKey) {
      // Binary documents - use Claude to extract
      console.log('Upload - extracting text from:', filename)

      const bytes = new Uint8Array(fileArrayBuffer)
      let base64 = ''
      const chunkSize = 32768
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

      try {
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
          contentText = data.content[0]?.text || null
          console.log('Upload - extraction succeeded, length:', contentText?.length)
        } else {
          console.error('Upload - extraction failed:', await response.text())
        }
      } catch (e) {
        console.error('Upload - extraction error:', e)
      }
    }

    // Save to database
    await c.env.DB.prepare(`
      INSERT INTO documents (id, workspace_id, uploaded_by, filename, file_type, mime_type, file_size, r2_key, content_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(id, user.workspace_id, user.id, file.name, fileType, file.type, file.size, r2Key, contentText?.slice(0, 50000) || null)
      .run()

    // Generate embedding for searchable content (FREE via Cloudflare AI)
    let hasEmbedding = false
    if (contentText && contentText.length > 0) {
      try {
        const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: contentText.slice(0, 8000),
        })

        if (embedding.data && embedding.data[0]) {
          await c.env.VECTORIZE.upsert([{
            id: `doc_${id}`,
            values: embedding.data[0],
            metadata: {
              type: 'document',
              document_id: id,
              workspace_id: user.workspace_id,
              filename: file.name,
            },
          }])

          await c.env.DB.prepare('UPDATE documents SET has_embedding = 1 WHERE id = ?')
            .bind(id)
            .run()
          hasEmbedding = true
        }
      } catch (embedError) {
        console.error('Embedding error:', embedError)
      }
    }

    // Auto-tag document if we have content and API key
    const assignedTags: Array<{ id: string; name: string; color: string; tag_type: string }> = []
    if (contentText && apiKey) {
      try {
        const tags = await autoTagDocument(contentText, apiKey, filename)
        console.log('Auto-tag results:', tags)

        // Color scheme for tag types
        const colors = {
          client: '#f59e0b', // amber
          topic: '#3b82f6',  // blue
          type: '#8b5cf6',   // purple
        }

        // Create/assign tags
        if (tags.client) {
          const tagId = await findOrCreateTag(c.env.DB, user.workspace_id, tags.client, 'client', colors.client)
          await c.env.DB.prepare(
            'INSERT OR IGNORE INTO document_tag_assignments (document_id, tag_id, assigned_by) VALUES (?, ?, ?)'
          ).bind(id, tagId, user.id).run()
          assignedTags.push({ id: tagId, name: tags.client, color: colors.client, tag_type: 'client' })
        }

        if (tags.topic) {
          const tagName = `${tags.topic}`
          const tagId = await findOrCreateTag(c.env.DB, user.workspace_id, tagName, 'topic', colors.topic)
          await c.env.DB.prepare(
            'INSERT OR IGNORE INTO document_tag_assignments (document_id, tag_id, assigned_by) VALUES (?, ?, ?)'
          ).bind(id, tagId, user.id).run()
          assignedTags.push({ id: tagId, name: tagName, color: colors.topic, tag_type: 'topic' })
        }

        if (tags.type) {
          const tagName = `${tags.type}`
          const tagId = await findOrCreateTag(c.env.DB, user.workspace_id, tagName, 'tag', colors.type)
          await c.env.DB.prepare(
            'INSERT OR IGNORE INTO document_tag_assignments (document_id, tag_id, assigned_by) VALUES (?, ?, ?)'
          ).bind(id, tagId, user.id).run()
          assignedTags.push({ id: tagId, name: tagName, color: colors.type, tag_type: 'tag' })
        }
      } catch (tagError) {
        console.error('Auto-tag error:', tagError)
      }
    }

    const document: Document = {
      id,
      workspace_id: user.workspace_id,
      uploaded_by: user.id,
      filename: file.name,
      file_type: fileType,
      mime_type: file.type,
      file_size: file.size,
      r2_key: r2Key,
      content_text: contentText || undefined,
      has_embedding: hasEmbedding,
      created_at: new Date().toISOString(),
      tags: assignedTags,
    }

    return c.json({ document })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ message: 'Failed to upload document' }, 500)
  }
})

// Extract text content from a document (for docs that weren't processed on upload)
documents.post('/:id/extract', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    // Get document
    const doc = await c.env.DB.prepare(
      'SELECT * FROM documents WHERE id = ? AND workspace_id = ?'
    )
      .bind(docId, user.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Skip if already has content
    if (doc.content_text) {
      return c.json({ message: 'Document already has extracted content', content_text: doc.content_text })
    }

    if (!doc.r2_key) {
      return c.json({ message: 'Document has no R2 file' }, 400)
    }

    // Get file from R2
    const object = await c.env.R2_BUCKET.get(doc.r2_key as string)
    if (!object) {
      return c.json({ message: 'File not found in storage' }, 404)
    }

    console.log('Extract endpoint - doc:', doc.filename, 'type:', doc.file_type, 'mime:', doc.mime_type, 'size:', object.size)

    // Determine if we need Claude extraction
    const filename = doc.filename as string
    const isDocx = doc.file_type === 'doc' || (doc.mime_type as string)?.includes('word') || filename?.endsWith('.docx') || filename?.endsWith('.doc')
    const isPdf = doc.file_type === 'pdf' || doc.mime_type === 'application/pdf'
    const isSpreadsheet = doc.file_type === 'spreadsheet' || (doc.mime_type as string)?.includes('sheet') || (doc.mime_type as string)?.includes('excel') || filename?.endsWith('.xlsx') || filename?.endsWith('.xls') || filename?.endsWith('.csv')
    const isPpt = (doc.mime_type as string)?.includes('presentation') || (doc.mime_type as string)?.includes('powerpoint') || filename?.endsWith('.pptx') || filename?.endsWith('.ppt')

    let extractedContent: string | null = null

    if (isPdf || isDocx || isSpreadsheet || isPpt) {
      // Get workspace API key
      const workspaceRow = await c.env.DB.prepare(
        'SELECT claude_api_key_encrypted FROM workspaces WHERE id = ?'
      )
        .bind(user.workspace_id)
        .first()

      if (!workspaceRow?.claude_api_key_encrypted) {
        return c.json({ message: 'No API key configured. Go to Settings → Workspace Settings → Brain AI to add one.' }, 400)
      }

      const { decryptApiKey } = await import('../lib/auth')
      const apiKey = decryptApiKey(workspaceRow.claude_api_key_encrypted as string, c.env.JWT_SECRET)

      // Get base64 of document (chunked to avoid stack overflow)
      const arrayBuffer = await object.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      // Use chunked encoding to avoid call stack issues with large files
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

      console.log('Extract endpoint - calling Claude with mediaType:', mediaType)

      // Call Claude to extract text
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
        extractedContent = data.content[0]?.text || null
        console.log('Extract endpoint - Claude extraction succeeded, length:', extractedContent?.length)
      } else {
        const errorText = await response.text()
        console.error('Extract endpoint - Claude extraction failed:', errorText)
        return c.json({ message: 'Claude extraction failed', error: errorText }, 500)
      }
    } else {
      // Plain text file - read directly
      const text = await object.text()
      if (text && !text.includes('\0') && text.length < 100000) {
        extractedContent = text
      }
    }

    if (!extractedContent) {
      return c.json({ message: 'Could not extract content from this file type' }, 400)
    }

    // Save to database
    await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
      .bind(extractedContent.slice(0, 50000), docId)
      .run()

    // Generate embedding
    try {
      const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: extractedContent.slice(0, 8000),
      })

      if (embedding.data && embedding.data[0]) {
        await c.env.VECTORIZE.upsert([{
          id: `doc_${docId}`,
          values: embedding.data[0],
          metadata: {
            type: 'document',
            document_id: docId,
            workspace_id: user.workspace_id,
            filename: filename,
          },
        }])

        await c.env.DB.prepare('UPDATE documents SET has_embedding = 1 WHERE id = ?')
          .bind(docId)
          .run()
      }
    } catch (embedError) {
      console.error('Embedding error:', embedError)
    }

    return c.json({
      success: true,
      content_text: extractedContent.slice(0, 2000) + (extractedContent.length > 2000 ? '...' : ''),
      content_length: extractedContent.length,
    })
  } catch (error) {
    console.error('Extract error:', error)
    return c.json({ message: 'Failed to extract content' }, 500)
  }
})

// Create document from pasted text content
documents.post('/text', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { title, content, groupId } = await c.req.json<{
      title: string
      content: string
      groupId: string
    }>()

    if (!content?.trim()) {
      return c.json({ message: 'Content is required' }, 400)
    }

    if (!groupId) {
      return c.json({ message: 'Group ID is required' }, 400)
    }

    // Verify user is member of the group
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    const id = crypto.randomUUID()
    const filename = `${title || 'Shared content'}.txt`
    const contentText = content.trim()
    const r2Key = `${user.workspace_id}/${id}/${filename}`

    // Upload to R2
    await c.env.R2_BUCKET.put(r2Key, contentText, {
      httpMetadata: {
        contentType: 'text/plain',
      },
      customMetadata: {
        workspace_id: user.workspace_id,
        uploaded_by: user.id,
        original_filename: filename,
      },
    })

    // Save to database
    await c.env.DB.prepare(`
      INSERT INTO documents (id, workspace_id, uploaded_by, filename, file_type, mime_type, file_size, r2_key, content_text)
      VALUES (?, ?, ?, ?, 'text', 'text/plain', ?, ?, ?)
    `)
      .bind(id, user.workspace_id, user.id, filename, contentText.length, r2Key, contentText)
      .run()

    // Generate embedding for RAG search
    try {
      const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: contentText.slice(0, 8000), // Limit text length
      })

      if (embedding.data && embedding.data[0]) {
        await c.env.VECTORIZE.upsert([{
          id: `doc_${id}`,
          values: embedding.data[0],
          metadata: {
            type: 'document',
            document_id: id,
            workspace_id: user.workspace_id,
            filename: filename,
          },
        }])

        await c.env.DB.prepare('UPDATE documents SET has_embedding = 1 WHERE id = ?')
          .bind(id)
          .run()
      }
    } catch (embedError) {
      console.error('Embedding error:', embedError)
      // Continue without embedding
    }

    const document = {
      id,
      workspace_id: user.workspace_id,
      uploaded_by: user.id,
      filename,
      file_type: 'text',
      mime_type: 'text/plain',
      file_size: contentText.length,
      r2_key: r2Key,
      content_text: contentText,
      has_embedding: true,
      created_at: new Date().toISOString(),
    }

    return c.json({ document })
  } catch (error) {
    console.error('Create text document error:', error)
    return c.json({ message: 'Failed to create document' }, 500)
  }
})

// Get document download URL
documents.get('/:id/download', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const doc = await c.env.DB.prepare(
      'SELECT * FROM documents WHERE id = ? AND workspace_id = ?'
    )
      .bind(docId, user.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    const object = await c.env.R2_BUCKET.get(doc.r2_key as string)
    if (!object) {
      return c.json({ message: 'File not found' }, 404)
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': doc.mime_type as string,
        'Content-Disposition': `attachment; filename="${doc.filename}"`,
      },
    })
  } catch (error) {
    console.error('Download error:', error)
    return c.json({ message: 'Failed to download document' }, 500)
  }
})

// Delete document
documents.delete('/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const doc = await c.env.DB.prepare(
      'SELECT * FROM documents WHERE id = ? AND workspace_id = ?'
    )
      .bind(docId, user.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Delete from R2
    await c.env.R2_BUCKET.delete(doc.r2_key as string)

    // Delete from Vectorize
    try {
      await c.env.VECTORIZE.deleteByIds([`doc_${docId}`])
    } catch (e) {
      // Ignore vectorize errors
    }

    // Delete from database (cascade will handle tag assignments)
    await c.env.DB.prepare('DELETE FROM documents WHERE id = ?')
      .bind(docId)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return c.json({ message: 'Failed to delete document' }, 500)
  }
})

// Toggle document as reference (for Brain context)
documents.put('/:id/reference', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const { is_reference, group_id } = await c.req.json<{ is_reference: boolean; group_id: string }>()

    // Verify document belongs to workspace
    const doc = await c.env.DB.prepare(
      'SELECT id, filename FROM documents WHERE id = ? AND workspace_id = ?'
    )
      .bind(docId, user.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Verify user is member of the group
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(group_id, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    // Update reference status
    await c.env.DB.prepare(
      'UPDATE documents SET is_reference = ? WHERE id = ?'
    )
      .bind(is_reference ? 1 : 0, docId)
      .run()

    return c.json({ success: true, is_reference })
  } catch (error) {
    console.error('Toggle reference error:', error)
    return c.json({ message: 'Failed to update reference status' }, 500)
  }
})

// Get reference documents for a group/channel
documents.get('/reference/:groupId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const groupId = c.req.param('groupId')

  try {
    // Verify user is member of the group
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    // Get all reference documents that have been shared to this channel
    const rows = await c.env.DB.prepare(`
      SELECT DISTINCT d.*, u.name as uploader_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      JOIN messages m ON m.group_id = ? AND m.type = 'media' AND m.deleted_at IS NULL
      WHERE d.workspace_id = ?
        AND d.is_reference = 1
        AND json_extract(m.media_data, '$.documentId') = d.id
      ORDER BY d.filename
    `)
      .bind(groupId, user.workspace_id)
      .all()

    return c.json({
      documents: (rows.results || []).map((row: any) => ({
        id: row.id,
        filename: row.filename,
        file_type: row.file_type,
        content_text: row.content_text,
        is_reference: !!row.is_reference,
        uploader: { name: row.uploader_name },
      })),
    })
  } catch (error) {
    console.error('Get reference docs error:', error)
    return c.json({ message: 'Failed to get reference documents' }, 500)
  }
})

// Search documents using vector similarity
documents.post('/search', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { query, limit = 10 } = await c.req.json<{ query: string; limit?: number }>()

    if (!query) {
      return c.json({ message: 'Query is required' }, 400)
    }

    // Generate embedding for query
    const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: query,
    })

    if (!embedding.data || !embedding.data[0]) {
      return c.json({ message: 'Failed to generate embedding' }, 500)
    }

    // Search vectorize
    const results = await c.env.VECTORIZE.query(embedding.data[0], {
      topK: limit,
      filter: {
        type: 'document',
        workspace_id: user.workspace_id,
      },
      returnMetadata: true,
    })

    // Get full document info for matches
    const docIds = results.matches
      .filter((m: any) => m.metadata?.document_id)
      .map((m: any) => m.metadata.document_id)

    if (docIds.length === 0) {
      return c.json({ documents: [], query })
    }

    const placeholders = docIds.map(() => '?').join(',')
    const rows = await c.env.DB.prepare(`
      SELECT d.*, u.name as uploader_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      WHERE d.id IN (${placeholders})
    `)
      .bind(...docIds)
      .all()

    const docs = (rows.results || []).map((row: any) => ({
      id: row.id,
      filename: row.filename,
      file_type: row.file_type,
      created_at: row.created_at,
      uploader: { name: row.uploader_name },
      score: results.matches.find((m: any) => m.metadata?.document_id === row.id)?.score || 0,
    }))

    // Sort by score
    docs.sort((a: any, b: any) => b.score - a.score)

    return c.json({ documents: docs, query })
  } catch (error) {
    console.error('Search error:', error)
    return c.json({ message: 'Failed to search documents' }, 500)
  }
})

// === Tags ===

// List tags
documents.get('/tags', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const rows = await c.env.DB.prepare(
      'SELECT * FROM document_tags WHERE workspace_id = ? ORDER BY name'
    )
      .bind(user.workspace_id)
      .all()

    return c.json({ tags: rows.results || [] })
  } catch (error) {
    console.error('List tags error:', error)
    return c.json({ message: 'Failed to list tags' }, 500)
  }
})

// Create tag
documents.post('/tags', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { name, color = '#3b82f6', tag_type = 'tag' } = await c.req.json<{
      name: string
      color?: string
      tag_type?: 'deal' | 'client' | 'topic' | 'tag'
    }>()

    if (!name?.trim()) {
      return c.json({ message: 'Tag name is required' }, 400)
    }

    const id = crypto.randomUUID()

    await c.env.DB.prepare(
      'INSERT INTO document_tags (id, workspace_id, name, color, tag_type) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(id, user.workspace_id, name.trim(), color, tag_type)
      .run()

    const tag: DocumentTag = {
      id,
      workspace_id: user.workspace_id,
      name: name.trim(),
      color,
      tag_type,
      created_at: new Date().toISOString(),
    }

    return c.json({ tag })
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ message: 'Tag already exists' }, 400)
    }
    console.error('Create tag error:', error)
    return c.json({ message: 'Failed to create tag' }, 500)
  }
})

// Add tag to document
documents.post('/:id/tags', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')

  try {
    const { tag_id } = await c.req.json<{ tag_id: string }>()

    // Verify document belongs to workspace
    const doc = await c.env.DB.prepare(
      'SELECT id FROM documents WHERE id = ? AND workspace_id = ?'
    )
      .bind(docId, user.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Verify tag belongs to workspace
    const tag = await c.env.DB.prepare(
      'SELECT id FROM document_tags WHERE id = ? AND workspace_id = ?'
    )
      .bind(tag_id, user.workspace_id)
      .first()

    if (!tag) {
      return c.json({ message: 'Tag not found' }, 404)
    }

    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO document_tag_assignments (document_id, tag_id, assigned_by) VALUES (?, ?, ?)'
    )
      .bind(docId, tag_id, user.id)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Add tag error:', error)
    return c.json({ message: 'Failed to add tag' }, 500)
  }
})

// Remove tag from document
documents.delete('/:id/tags/:tagId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  const docId = c.req.param('id')
  const tagId = c.req.param('tagId')

  try {
    await c.env.DB.prepare(
      'DELETE FROM document_tag_assignments WHERE document_id = ? AND tag_id = ?'
    )
      .bind(docId, tagId)
      .run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Remove tag error:', error)
    return c.json({ message: 'Failed to remove tag' }, 500)
  }
})

// Share document to a group chat with automatic summarization
documents.post('/share-to-group', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { documentId, groupId, summarize = true } = await c.req.json<{
      documentId: string
      groupId: string
      summarize?: boolean
    }>()

    // Get document
    const doc = await c.env.DB.prepare(
      'SELECT * FROM documents WHERE id = ? AND workspace_id = ?'
    )
      .bind(documentId, user.workspace_id)
      .first()

    if (!doc) {
      return c.json({ message: 'Document not found' }, 404)
    }

    // Check user is in the group
    const membership = await c.env.DB.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
    )
      .bind(groupId, user.id)
      .first()

    if (!membership) {
      return c.json({ message: 'Not a member of this group' }, 403)
    }

    // Get file content from R2
    let fileContent = doc.content_text as string | null

    if (!fileContent && doc.r2_key) {
      const object = await c.env.R2_BUCKET.get(doc.r2_key as string)
      if (object) {
        // For PDFs, DOCX, spreadsheets, and other document files, use Claude to extract/summarize
        const isDocx = doc.file_type === 'doc' || doc.mime_type?.includes('word') || doc.filename?.endsWith('.docx') || doc.filename?.endsWith('.doc')
        const isPdf = doc.file_type === 'pdf' || doc.mime_type === 'application/pdf'
        const isSpreadsheet = doc.file_type === 'spreadsheet' || doc.mime_type?.includes('sheet') || doc.mime_type?.includes('excel') || doc.filename?.endsWith('.xlsx') || doc.filename?.endsWith('.xls') || doc.filename?.endsWith('.csv')
        const isPpt = doc.mime_type?.includes('presentation') || doc.mime_type?.includes('powerpoint') || doc.filename?.endsWith('.pptx') || doc.filename?.endsWith('.ppt')

        if (isPdf || isDocx || isSpreadsheet || isPpt) {
          // Get base64 of document for Claude (chunked to avoid stack overflow)
          const arrayBuffer = await object.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)

          // Use chunked encoding to avoid call stack issues with large files
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
          else if (isDocx) mediaType = doc.filename?.endsWith('.doc') ? 'application/msword' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          else if (isSpreadsheet) {
            if (doc.filename?.endsWith('.csv')) mediaType = 'text/csv'
            else if (doc.filename?.endsWith('.xls')) mediaType = 'application/vnd.ms-excel'
            else mediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }
          else if (isPpt) {
            if (doc.filename?.endsWith('.ppt')) mediaType = 'application/vnd.ms-powerpoint'
            else mediaType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          }

          // Use Claude to extract and summarize PDF content
          const workspaceRow = await c.env.DB.prepare(
            'SELECT w.claude_api_key_encrypted FROM workspaces w JOIN groups g ON g.workspace_id = w.id WHERE g.id = ?'
          )
            .bind(groupId)
            .first()

          if (workspaceRow?.claude_api_key_encrypted) {
            const { decryptApiKey } = await import('../lib/auth')
            const apiKey = decryptApiKey(workspaceRow.claude_api_key_encrypted as string, c.env.JWT_SECRET)

            // Call Claude with document (PDF or DOCX)
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
                      text: 'Please extract ALL the text content from this document. Include everything - headings, body text, lists, tables. Format it clearly with markdown. After extracting the content, provide a brief summary at the top.',
                    },
                  ],
                }],
              }),
            })

            if (response.ok) {
              const data = await response.json() as { content: Array<{ type: string; text: string }> }
              fileContent = data.content[0]?.text || null

              // Save extracted content back to document for future use
              if (fileContent) {
                await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
                  .bind(fileContent.slice(0, 50000), documentId)
                  .run()

                // Generate embedding for RAG search
                try {
                  const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
                    text: fileContent.slice(0, 8000),
                  })

                  if (embedding.data && embedding.data[0]) {
                    await c.env.VECTORIZE.upsert([{
                      id: `doc_${documentId}`,
                      values: embedding.data[0],
                      metadata: {
                        type: 'document',
                        document_id: documentId,
                        workspace_id: user.workspace_id,
                        filename: doc.filename as string,
                      },
                    }])

                    await c.env.DB.prepare('UPDATE documents SET has_embedding = 1 WHERE id = ?')
                      .bind(documentId)
                      .run()
                  }
                } catch (embedError) {
                  console.error('Embedding error:', embedError)
                }
              }
            } else {
              console.error('Claude extraction failed:', await response.text())
            }
          }
        } else {
          // For text files, just read directly
          const text = await object.text()
          if (text && !text.includes('\0') && text.length < 100000) {
            fileContent = text

            // Save extracted content back to document for future use
            await c.env.DB.prepare('UPDATE documents SET content_text = ? WHERE id = ?')
              .bind(fileContent.slice(0, 50000), documentId)
              .run()
          }
        }
      }
    }

    // Create the message
    const messageId = crypto.randomUUID()
    const now = new Date().toISOString()

    const fileData = {
      type: 'file',
      documentId: documentId,
      filename: doc.filename,
      fileType: doc.file_type,
      fileSize: doc.file_size,
      mimeType: doc.mime_type,
      summary: fileContent?.slice(0, 2000) || null, // Include summary in media_data
    }

    const messageContent = fileContent
      ? `📄 **${doc.filename}**\n\n${fileContent.slice(0, 1500)}${fileContent.length > 1500 ? '...' : ''}`
      : `Shared a file: ${doc.filename}`

    await c.env.DB.prepare(`
      INSERT INTO messages (id, group_id, user_id, type, content, media_data, created_at)
      VALUES (?, ?, ?, 'media', ?, ?, ?)
    `)
      .bind(messageId, groupId, user.id, messageContent, JSON.stringify(fileData), now)
      .run()

    // Get user info for response
    const userRow = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
      .bind(user.id)
      .first()

    return c.json({
      message: {
        id: messageId,
        group_id: groupId,
        user_id: user.id,
        type: 'media',
        content: messageContent,
        media_data: JSON.stringify(fileData),
        created_at: now,
        author: {
          id: user.id,
          name: userRow?.name || user.name,
          email: userRow?.email || user.email,
        },
      },
      summary: fileContent?.slice(0, 2000) || null,
    })
  } catch (error) {
    console.error('Share to group error:', error)
    return c.json({ message: 'Failed to share document' }, 500)
  }
})

// Create a document from pasted text content (for sharing transcripts, notes, etc.)
documents.post('/text', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ message: 'Unauthorized' }, 401)

  try {
    const { title, content, groupId } = await c.req.json<{
      title: string
      content: string
      groupId: string
    }>()

    if (!title?.trim() || !content?.trim() || !groupId) {
      return c.json({ message: 'Title, content, and groupId are required' }, 400)
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

    // Create the document record
    const docId = crypto.randomUUID()
    const now = new Date().toISOString()
    const filename = title.trim().endsWith('.txt') ? title.trim() : `${title.trim()}.txt`
    const fileSize = new TextEncoder().encode(content).length

    await c.env.DB.prepare(`
      INSERT INTO documents (id, workspace_id, uploaded_by, filename, file_type, mime_type, file_size, content_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(docId, user.workspace_id, user.id, filename, 'text', 'text/plain', fileSize, content.trim(), now)
      .run()

    // Index for RAG search (embed the content)
    try {
      // Use Cloudflare AI to embed and store in Vectorize
      const { storeMessageEmbedding } = await import('../lib/vectorstore')
      await storeMessageEmbedding(c.env, {
        id: `doc-${docId}`,
        groupId,
        userId: user.id,
        authorName: user.name,
        content: `Document "${filename}": ${content.trim().slice(0, 5000)}`,
        createdAt: now,
        type: 'document',
      }, {
        provider: 'cloudflare',
        userId: user.id,
      })
    } catch (embedError) {
      console.error('Failed to embed document:', embedError)
      // Continue even if embedding fails - the document is still created
    }

    return c.json({
      document: {
        id: docId,
        workspace_id: user.workspace_id,
        uploaded_by: user.id,
        filename,
        file_type: 'text',
        mime_type: 'text/plain',
        file_size: fileSize,
        content_text: content.trim(),
        created_at: now,
      },
    })
  } catch (error) {
    console.error('Create text document error:', error)
    return c.json({ message: 'Failed to create document' }, 500)
  }
})

export default documents
