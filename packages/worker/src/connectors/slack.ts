import type { Env, Integration, IndexedItem } from '../types'
import { decrypt } from '../utils/encryption'

interface SlackChannel {
  id: string
  name: string
  is_channel: boolean
  is_member: boolean
}

interface SlackUser {
  id: string
  name: string
  real_name?: string
  profile?: {
    email?: string
    display_name?: string
    real_name?: string
  }
}

interface SlackMessage {
  ts: string
  text: string
  user?: string
  type: string
  subtype?: string
  thread_ts?: string
  reply_count?: number
  reactions?: Array<{ name: string; count: number; users: string[] }>
  files?: Array<{
    id: string
    name: string
    filetype: string
    size: number
    url_private?: string
    permalink?: string
  }>
}

interface SlackApiResponse<T> {
  ok: boolean
  error?: string
  response_metadata?: {
    next_cursor?: string
  }
  channels?: T[]
  members?: T[]
  messages?: T[]
  user?: SlackUser
}

export class SlackConnector {
  private env: Env
  private integration: Integration
  private accessToken: string | null = null
  private userCache: Map<string, SlackUser> = new Map()

  constructor(env: Env, integration: Integration) {
    this.env = env
    this.integration = integration
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken

    if (!this.integration.access_token_encrypted) {
      throw new Error('No access token available')
    }

    this.accessToken = await decrypt(
      this.integration.access_token_encrypted,
      this.env.ENCRYPTION_KEY
    )
    return this.accessToken
  }

  private async slackApi<T>(endpoint: string, params: Record<string, string> = {}): Promise<SlackApiResponse<T>> {
    const token = await this.getAccessToken()
    const url = new URL(`https://slack.com/api/${endpoint}`)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })

    const data = await response.json() as SlackApiResponse<T>
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`)
    }
    return data
  }

  async getUser(userId: string): Promise<SlackUser | null> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!
    }

    try {
      const response = await this.slackApi<SlackUser>('users.info', { user: userId })
      if (response.user) {
        this.userCache.set(userId, response.user)
        return response.user
      }
    } catch (err) {
      console.error(`Failed to get user ${userId}:`, err)
    }
    return null
  }

  async getChannels(): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = []
    let cursor = ''

    do {
      const params: Record<string, string> = {
        types: 'public_channel,private_channel',
        limit: '200',
      }
      if (cursor) params.cursor = cursor

      const response = await this.slackApi<SlackChannel>('conversations.list', params)
      if (response.channels) {
        channels.push(...response.channels.filter(c => c.is_member))
      }
      cursor = response.response_metadata?.next_cursor || ''
    } while (cursor)

    return channels
  }

  async getChannelHistory(channelId: string, oldest?: string): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = []
    let cursor = ''

    do {
      const params: Record<string, string> = {
        channel: channelId,
        limit: '100',
      }
      if (oldest) params.oldest = oldest
      if (cursor) params.cursor = cursor

      const response = await this.slackApi<SlackMessage>('conversations.history', params)
      if (response.messages) {
        // Filter out subtypes we don't want (joins, leaves, etc.)
        const filteredMessages = response.messages.filter(
          m => !m.subtype || ['file_share', 'thread_broadcast'].includes(m.subtype)
        )
        messages.push(...filteredMessages)
      }
      cursor = response.response_metadata?.next_cursor || ''
    } while (cursor && messages.length < 1000) // Limit per channel

    return messages
  }

  async syncAll(progressCallback?: (status: string, count: number) => void): Promise<number> {
    let totalIndexed = 0

    try {
      // Update status to syncing
      await this.env.DB.prepare(
        'UPDATE integrations SET status = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind('syncing', this.integration.id).run()

      // Get all channels bot has access to
      progressCallback?.('Fetching channels...', 0)
      const channels = await this.getChannels()
      console.log(`Found ${channels.length} channels to sync`)

      // Get config to check for channel filter
      const config = this.integration.config ? JSON.parse(this.integration.config) : {}
      const teamId = config.team_id

      for (const channel of channels) {
        progressCallback?.(`Syncing #${channel.name}...`, totalIndexed)

        try {
          // Get cursor from last sync (stored per-channel)
          const syncCursor = this.integration.sync_cursor
            ? JSON.parse(this.integration.sync_cursor)
            : {}
          const lastTs = syncCursor[channel.id]

          const messages = await this.getChannelHistory(channel.id, lastTs)
          console.log(`Found ${messages.length} messages in #${channel.name}`)

          // Index each message
          for (const message of messages) {
            if (!message.text?.trim()) continue

            const user = message.user ? await this.getUser(message.user) : null
            const userEmail = user?.profile?.email
            const userName = user?.profile?.real_name || user?.real_name || user?.name || 'Unknown'

            // Build deep link to message
            const messageTs = message.ts.replace('.', '')
            const sourceUrl = `https://app.slack.com/client/${teamId}/${channel.id}/p${messageTs}`

            // Prepare indexed item
            const itemId = `slack_${channel.id}_${message.ts}`
            const messageDate = new Date(parseFloat(message.ts) * 1000).toISOString()

            await this.env.DB.prepare(`
              INSERT INTO indexed_items (
                id, workspace_id, integration_id, source, source_id, source_url,
                title, content, content_type, author_id, author_name, author_email,
                created_at, channel_id, channel_name, thread_id, reply_count,
                reactions, has_embedding, indexed_at
              ) VALUES (?, ?, ?, 'slack', ?, ?, ?, ?, 'message', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
              ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
                content = excluded.content,
                reply_count = excluded.reply_count,
                reactions = excluded.reactions,
                updated_at = datetime('now')
            `).bind(
              itemId,
              this.integration.workspace_id,
              this.integration.id,
              message.ts,
              sourceUrl,
              `#${channel.name}`,
              message.text,
              message.user || null,
              userName,
              userEmail || null,
              messageDate,
              channel.id,
              channel.name,
              message.thread_ts || null,
              message.reply_count || 0,
              message.reactions ? JSON.stringify(message.reactions) : null
            ).run()

            totalIndexed++

            // Update people stats
            if (userEmail) {
              await this.updatePeopleStats(userEmail, userName, message.user || null, channel.id)
            }

            // Index any files attached to message
            if (message.files) {
              for (const file of message.files) {
                const fileItemId = `slack_file_${file.id}`
                await this.env.DB.prepare(`
                  INSERT INTO indexed_items (
                    id, workspace_id, integration_id, source, source_id, source_url,
                    title, content, content_type, author_id, author_name, author_email,
                    created_at, channel_id, channel_name, file_name, file_type, file_size,
                    has_embedding, indexed_at
                  ) VALUES (?, ?, ?, 'slack', ?, ?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
                  ON CONFLICT(workspace_id, source, source_id) DO NOTHING
                `).bind(
                  fileItemId,
                  this.integration.workspace_id,
                  this.integration.id,
                  file.id,
                  file.permalink || sourceUrl,
                  file.name,
                  `File shared: ${file.name}`,
                  message.user || null,
                  userName,
                  userEmail || null,
                  messageDate,
                  channel.id,
                  channel.name,
                  file.name,
                  file.filetype,
                  file.size
                ).run()

                totalIndexed++
              }
            }
          }

          // Update sync cursor for this channel
          if (messages.length > 0) {
            const latestTs = messages[0].ts // Messages are in reverse chronological order
            syncCursor[channel.id] = latestTs
            await this.env.DB.prepare(
              'UPDATE integrations SET sync_cursor = ?, updated_at = datetime("now") WHERE id = ?'
            ).bind(JSON.stringify(syncCursor), this.integration.id).run()
          }
        } catch (err) {
          console.error(`Error syncing channel #${channel.name}:`, err)
        }
      }

      // Update integration status
      await this.env.DB.prepare(`
        UPDATE integrations
        SET status = 'active', items_indexed = ?, last_sync_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(totalIndexed, this.integration.id).run()

      progressCallback?.('Sync complete', totalIndexed)
    } catch (err) {
      console.error('Slack sync error:', err)
      await this.env.DB.prepare(
        'UPDATE integrations SET status = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind('error', this.integration.id).run()
      throw err
    }

    return totalIndexed
  }

  private async updatePeopleStats(
    email: string,
    name: string,
    slackUserId: string | null,
    channelId: string
  ): Promise<void> {
    // Get existing stats
    const existing = await this.env.DB.prepare(`
      SELECT * FROM people_stats WHERE workspace_id = ? AND email = ?
    `).bind(this.integration.workspace_id, email).first<any>()

    if (existing) {
      // Update existing
      const channels = existing.channels_active ? JSON.parse(existing.channels_active) : []
      if (!channels.includes(channelId)) {
        channels.push(channelId)
      }

      await this.env.DB.prepare(`
        UPDATE people_stats SET
          total_messages = total_messages + 1,
          channels_active = ?,
          last_active_at = datetime('now'),
          stats_updated_at = datetime('now')
        WHERE id = ?
      `).bind(JSON.stringify(channels), existing.id).run()
    } else {
      // Create new
      await this.env.DB.prepare(`
        INSERT INTO people_stats (
          id, workspace_id, email, name, slack_user_id,
          total_messages, total_files_shared, total_reactions_received,
          channels_active, last_active_at, stats_updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, datetime('now'), datetime('now'))
      `).bind(
        crypto.randomUUID(),
        this.integration.workspace_id,
        email,
        name,
        slackUserId,
        JSON.stringify([channelId])
      ).run()
    }
  }
}
