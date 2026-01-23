import type { Env, Integration } from '../types'
import { decrypt } from '../utils/encryption'

interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  createdTime: string
  modifiedTime: string
  webViewLink?: string
  owners?: Array<{ displayName: string; emailAddress: string }>
  parents?: string[]
  description?: string
}

interface GoogleDriveListResponse {
  files: GoogleDriveFile[]
  nextPageToken?: string
}

export class GoogleDriveConnector {
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

    // Encrypt and store new access token
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

  private async driveApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken()
    const response = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Drive API error: ${response.status} ${error}`)
    }

    return response.json() as Promise<T>
  }

  async listFiles(pageToken?: string): Promise<GoogleDriveListResponse> {
    const params = new URLSearchParams({
      pageSize: '100',
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,owners,parents,description)',
      q: "trashed = false and (mimeType contains 'document' or mimeType contains 'spreadsheet' or mimeType contains 'presentation' or mimeType contains 'pdf' or mimeType contains 'text')",
      orderBy: 'modifiedTime desc',
    })
    if (pageToken) params.set('pageToken', pageToken)

    return this.driveApi<GoogleDriveListResponse>(`/files?${params.toString()}`)
  }

  async getFileContent(fileId: string, mimeType: string): Promise<string | null> {
    const token = await this.getAccessToken()

    // Google Docs/Sheets/Slides can be exported as plain text
    if (mimeType.includes('google-apps')) {
      let exportMime = 'text/plain'
      if (mimeType.includes('spreadsheet')) {
        exportMime = 'text/csv'
      }

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      if (response.ok) {
        const text = await response.text()
        return text.slice(0, 10000) // Limit to 10k chars
      }
    }

    // For PDFs and other files, we'd need to download and process
    // For now, return null and just index metadata
    return null
  }

  async syncAll(progressCallback?: (status: string, count: number) => void): Promise<number> {
    let totalIndexed = 0

    try {
      await this.env.DB.prepare(
        'UPDATE integrations SET status = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind('syncing', this.integration.id).run()

      progressCallback?.('Fetching files from Google Drive...', 0)

      let pageToken: string | undefined
      const config = this.integration.config ? JSON.parse(this.integration.config) : {}

      do {
        const response = await this.listFiles(pageToken)
        console.log(`Found ${response.files.length} files`)

        for (const file of response.files) {
          progressCallback?.(`Indexing ${file.name}...`, totalIndexed)

          try {
            const owner = file.owners?.[0]
            const content = await this.getFileContent(file.id, file.mimeType)

            // Determine content type
            let contentType = 'file'
            if (file.mimeType.includes('document') || file.mimeType.includes('text')) {
              contentType = 'file'
            } else if (file.mimeType.includes('spreadsheet')) {
              contentType = 'file'
            }

            // Build indexed content
            let indexedContent = file.description || ''
            if (content) {
              indexedContent = content
            } else {
              indexedContent = `File: ${file.name}`
            }

            const itemId = `gdrive_${file.id}`

            await this.env.DB.prepare(`
              INSERT INTO indexed_items (
                id, workspace_id, integration_id, source, source_id, source_url,
                title, content, content_type, author_name, author_email,
                created_at, updated_at, file_name, file_type, file_size,
                has_embedding, indexed_at
              ) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
              ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                updated_at = excluded.updated_at
            `).bind(
              itemId,
              this.integration.workspace_id,
              this.integration.id,
              file.id,
              file.webViewLink || `https://drive.google.com/file/d/${file.id}`,
              file.name,
              indexedContent,
              contentType,
              owner?.displayName || null,
              owner?.emailAddress || null,
              file.createdTime,
              file.modifiedTime,
              file.name,
              file.mimeType,
              file.size ? parseInt(file.size) : null
            ).run()

            totalIndexed++

            // Update people stats
            if (owner?.emailAddress) {
              await this.updatePeopleStats(owner.emailAddress, owner.displayName)
            }
          } catch (err) {
            console.error(`Error indexing file ${file.name}:`, err)
          }
        }

        pageToken = response.nextPageToken
      } while (pageToken && totalIndexed < 500) // Limit total files

      // Update integration status
      await this.env.DB.prepare(`
        UPDATE integrations
        SET status = 'active', items_indexed = ?, last_sync_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(totalIndexed, this.integration.id).run()

      progressCallback?.('Sync complete', totalIndexed)
    } catch (err) {
      console.error('Google Drive sync error:', err)
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
          total_files_shared = total_files_shared + 1,
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
        ) VALUES (?, ?, ?, ?, 0, 1, 0, datetime('now'), datetime('now'))
      `).bind(
        crypto.randomUUID(),
        this.integration.workspace_id,
        email,
        name
      ).run()
    }
  }
}
