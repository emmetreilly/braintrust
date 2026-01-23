import type { Env, Integration } from '../types'
import { decrypt } from '../utils/encryption'

interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  payload: {
    headers: Array<{ name: string; value: string }>
    body?: { data?: string; size: number }
    parts?: Array<{
      mimeType: string
      body?: { data?: string; size: number }
    }>
  }
  internalDate: string
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

export class GmailConnector {
  private env: Env
  private integration: Integration
  private accessToken: string | null = null

  constructor(env: Env, integration: Integration) {
    this.env = env
    this.integration = integration
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken

    if (!this.integration.access_token_encrypted) {
      throw new Error('No access token available')
    }

    // Check if token is expired and refresh if needed
    if (this.integration.token_expires_at) {
      const expiresAt = new Date(this.integration.token_expires_at)
      if (expiresAt < new Date()) {
        await this.refreshToken()
      }
    }

    this.accessToken = await decrypt(
      this.integration.access_token_encrypted,
      this.env.ENCRYPTION_KEY
    )
    return this.accessToken
  }

  private async refreshToken(): Promise<void> {
    if (!this.integration.refresh_token_encrypted) {
      throw new Error('No refresh token available')
    }

    const refreshToken = await decrypt(
      this.integration.refresh_token_encrypted,
      this.env.ENCRYPTION_KEY
    )

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    const data = await response.json() as any
    if (data.error) {
      throw new Error(`Token refresh failed: ${data.error}`)
    }

    const { encrypt } = await import('../utils/encryption')
    const newAccessToken = await encrypt(data.access_token, this.env.ENCRYPTION_KEY)
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null

    await this.env.DB.prepare(`
      UPDATE integrations SET
        access_token_encrypted = ?,
        token_expires_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(newAccessToken, expiresAt, this.integration.id).run()

    this.accessToken = data.access_token
  }

  private async gmailApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken()
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gmail API error: ${response.status} ${error}`)
    }

    return response.json() as Promise<T>
  }

  async listMessages(pageToken?: string, query?: string): Promise<GmailListResponse> {
    const params = new URLSearchParams({
      maxResults: '50',
    })
    if (pageToken) params.set('pageToken', pageToken)
    if (query) params.set('q', query)

    return this.gmailApi<GmailListResponse>(`/messages?${params.toString()}`)
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    return this.gmailApi<GmailMessage>(`/messages/${messageId}?format=full`)
  }

  private getHeader(headers: Array<{ name: string; value: string }>, name: string): string | null {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase())
    return header?.value || null
  }

  private extractEmailBody(message: GmailMessage): string {
    // Try to get body from payload
    if (message.payload.body?.data) {
      return this.decodeBase64(message.payload.body.data)
    }

    // Try to find text/plain part
    if (message.payload.parts) {
      const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain')
      if (textPart?.body?.data) {
        return this.decodeBase64(textPart.body.data)
      }

      // Fallback to text/html
      const htmlPart = message.payload.parts.find(p => p.mimeType === 'text/html')
      if (htmlPart?.body?.data) {
        const html = this.decodeBase64(htmlPart.body.data)
        // Strip HTML tags for plain text
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }

    // Fallback to snippet
    return message.snippet || ''
  }

  private decodeBase64(data: string): string {
    // Gmail uses URL-safe base64
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
    try {
      return decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
    } catch {
      return atob(base64)
    }
  }

  private parseEmailAddress(header: string | null): { name: string | null; email: string | null } {
    if (!header) return { name: null, email: null }

    // Format: "Name <email@example.com>" or just "email@example.com"
    const match = header.match(/(?:"?([^"<]*)"?\s*)?<?([^\s<>]+@[^\s<>]+)>?/)
    if (match) {
      return {
        name: match[1]?.trim() || null,
        email: match[2]?.toLowerCase() || null,
      }
    }
    return { name: null, email: header.toLowerCase() }
  }

  async syncAll(progressCallback?: (status: string, count: number) => void): Promise<number> {
    let totalIndexed = 0

    try {
      await this.env.DB.prepare(
        'UPDATE integrations SET status = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind('syncing', this.integration.id).run()

      progressCallback?.('Fetching emails...', 0)

      // Get emails from last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const query = `after:${Math.floor(thirtyDaysAgo.getTime() / 1000)}`

      let pageToken: string | undefined

      do {
        const listResponse = await this.listMessages(pageToken, query)

        if (!listResponse.messages?.length) break

        console.log(`Found ${listResponse.messages.length} emails`)

        for (const msg of listResponse.messages) {
          progressCallback?.(`Indexing email...`, totalIndexed)

          try {
            const message = await this.getMessage(msg.id)
            const headers = message.payload.headers

            const subject = this.getHeader(headers, 'Subject') || '(No subject)'
            const fromHeader = this.getHeader(headers, 'From')
            const { name: fromName, email: fromEmail } = this.parseEmailAddress(fromHeader)
            const date = this.getHeader(headers, 'Date')
            const messageDate = date ? new Date(date).toISOString() : new Date(parseInt(message.internalDate)).toISOString()

            const body = this.extractEmailBody(message)
            const content = `${subject}\n\n${body}`.slice(0, 5000) // Limit content size

            // Build Gmail deep link
            const sourceUrl = `https://mail.google.com/mail/u/0/#inbox/${message.id}`

            const itemId = `gmail_${message.id}`

            await this.env.DB.prepare(`
              INSERT INTO indexed_items (
                id, workspace_id, integration_id, source, source_id, source_url,
                title, content, content_type, author_name, author_email,
                created_at, thread_id, has_embedding, indexed_at
              ) VALUES (?, ?, ?, 'gmail', ?, ?, ?, ?, 'email', ?, ?, ?, ?, 0, datetime('now'))
              ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                updated_at = datetime('now')
            `).bind(
              itemId,
              this.integration.workspace_id,
              this.integration.id,
              message.id,
              sourceUrl,
              subject,
              content,
              fromName,
              fromEmail,
              messageDate,
              message.threadId
            ).run()

            totalIndexed++

            // Update people stats for sender
            if (fromEmail) {
              await this.updatePeopleStats(fromEmail, fromName)
            }
          } catch (err) {
            console.error(`Error indexing email ${msg.id}:`, err)
          }
        }

        pageToken = listResponse.nextPageToken
      } while (pageToken && totalIndexed < 500) // Limit total emails

      // Update integration status
      await this.env.DB.prepare(`
        UPDATE integrations
        SET status = 'active', items_indexed = ?, last_sync_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(totalIndexed, this.integration.id).run()

      progressCallback?.('Sync complete', totalIndexed)
    } catch (err) {
      console.error('Gmail sync error:', err)
      await this.env.DB.prepare(
        'UPDATE integrations SET status = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind('error', this.integration.id).run()
      throw err
    }

    return totalIndexed
  }

  private async updatePeopleStats(email: string, name: string | null): Promise<void> {
    const existing = await this.env.DB.prepare(`
      SELECT * FROM people_stats WHERE workspace_id = ? AND email = ?
    `).bind(this.integration.workspace_id, email).first<any>()

    if (existing) {
      await this.env.DB.prepare(`
        UPDATE people_stats SET
          total_messages = total_messages + 1,
          last_active_at = datetime('now'),
          stats_updated_at = datetime('now')
        WHERE id = ?
      `).bind(existing.id).run()
    } else {
      await this.env.DB.prepare(`
        INSERT INTO people_stats (
          id, workspace_id, email, name,
          total_messages, total_files_shared, total_reactions_received,
          last_active_at, stats_updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, 0, datetime('now'), datetime('now'))
      `).bind(
        crypto.randomUUID(),
        this.integration.workspace_id,
        email,
        name
      ).run()
    }
  }
}
