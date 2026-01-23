import { Hono } from 'hono'
import { verifyToken } from '../lib/auth'
import type { Env, User, Integration } from '../types'
import { encrypt, decrypt } from '../utils/encryption'
import { SlackConnector } from '../connectors/slack'
import { GoogleDriveConnector } from '../connectors/google-drive'
import { GmailConnector } from '../connectors/gmail'
import { HubSpotConnector } from '../connectors/hubspot'
import { EmbeddingService } from '../services/embeddings'

const integrations = new Hono<{ Bindings: Env }>()

// Helper to encode/decode state for OAuth (works in Cloudflare Workers)
function encodeState(data: object): string {
  return btoa(JSON.stringify(data))
}

function decodeState(encoded: string): any {
  return JSON.parse(atob(encoded))
}

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

// List all integrations for workspace
integrations.get('/', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const result = await c.env.DB.prepare(`
    SELECT id, workspace_id, provider, status, last_sync_at, items_indexed, created_at, updated_at
    FROM integrations
    WHERE workspace_id = ?
  `).bind(user.workspace_id).all<Integration>()

  return c.json({ integrations: result.results || [] })
})

// Get integration status
integrations.get('/:id/status', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const id = c.req.param('id')
  const integration = await c.env.DB.prepare(`
    SELECT id, workspace_id, provider, status, last_sync_at, items_indexed, created_at, updated_at
    FROM integrations
    WHERE id = ? AND workspace_id = ?
  `).bind(id, user.workspace_id).first<Integration>()

  if (!integration) return c.json({ error: 'Integration not found' }, 404)

  return c.json({ integration })
})

// Disconnect integration
integrations.delete('/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const id = c.req.param('id')

  // Delete indexed items first
  await c.env.DB.prepare(`
    DELETE FROM indexed_items WHERE integration_id = ?
  `).bind(id).run()

  // Delete the integration
  await c.env.DB.prepare(`
    DELETE FROM integrations WHERE id = ? AND workspace_id = ?
  `).bind(id, user.workspace_id).run()

  return c.json({ success: true })
})

// Trigger manual sync
integrations.post('/:id/sync', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const id = c.req.param('id')
  const integration = await c.env.DB.prepare(`
    SELECT * FROM integrations WHERE id = ? AND workspace_id = ?
  `).bind(id, user.workspace_id).first<Integration>()

  if (!integration) return c.json({ error: 'Integration not found' }, 404)

  // Run sync based on provider
  try {
    let itemsIndexed = 0

    switch (integration.provider) {
      case 'slack': {
        const connector = new SlackConnector(c.env, integration)
        itemsIndexed = await connector.syncAll()
        break
      }
      case 'google_drive': {
        const connector = new GoogleDriveConnector(c.env, integration)
        itemsIndexed = await connector.syncAll()
        break
      }
      case 'gmail': {
        const connector = new GmailConnector(c.env, integration)
        itemsIndexed = await connector.syncAll()
        break
      }
      case 'hubspot': {
        const connector = new HubSpotConnector(c.env, integration, c.env.HUBSPOT_ACCESS_TOKEN)
        itemsIndexed = await connector.syncAll()
        break
      }
      default:
        return c.json({ error: 'Unsupported provider' }, 400)
    }

    // After sync, generate embeddings for new items
    const embeddingService = new EmbeddingService(c.env)
    await embeddingService.processUnembeddedItems(user.workspace_id, 100)

    return c.json({ success: true, message: 'Sync complete', items_indexed: itemsIndexed })
  } catch (err) {
    console.error('Sync error:', err)
    return c.json({ error: 'Sync failed', details: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

// ============================================
// SLACK OAUTH
// ============================================

// Start Slack OAuth flow
integrations.get('/slack/connect', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  const scopes = [
    'channels:history',
    'channels:read',
    'files:read',
    'users:read',
    'users:read.email',
    'team:read',
  ].join(',')

  // Store state to verify callback (includes workspace_id for security)
  const state = encodeState({
    workspace_id: user.workspace_id,
    user_id: user.id,
    timestamp: Date.now(),
  })

  const redirectUri = `${c.env.WORKER_URL}/api/integrations/slack/callback`
  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${c.env.SLACK_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`

  return c.json({ authUrl })
})

// Slack OAuth callback
integrations.get('/slack/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.redirect(`${c.env.WEB_URL}/settings?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return c.redirect(`${c.env.WEB_URL}/settings?error=missing_params`)
  }

  try {
    // Decode state
    const stateData = decodeState(state)
    const { workspace_id } = stateData

    // Verify state isn't too old (15 minutes)
    if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
      return c.redirect(`${c.env.WEB_URL}/settings?error=state_expired`)
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.SLACK_CLIENT_ID,
        client_secret: c.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: `${c.env.WORKER_URL}/api/integrations/slack/callback`,
      }),
    })

    const tokenData = await tokenResponse.json() as any

    if (!tokenData.ok) {
      console.error('Slack token error:', tokenData)
      return c.redirect(`${c.env.WEB_URL}/settings?error=token_exchange_failed`)
    }

    // Encrypt tokens
    const accessTokenEncrypted = await encrypt(tokenData.access_token, c.env.ENCRYPTION_KEY)
    const refreshTokenEncrypted = tokenData.refresh_token
      ? await encrypt(tokenData.refresh_token, c.env.ENCRYPTION_KEY)
      : null

    // Store integration
    const integrationId = crypto.randomUUID()
    const config = JSON.stringify({
      team_id: tokenData.team?.id,
      team_name: tokenData.team?.name,
      bot_user_id: tokenData.bot_user_id,
      authed_user_id: tokenData.authed_user?.id,
    })

    await c.env.DB.prepare(`
      INSERT INTO integrations (id, workspace_id, provider, status, access_token_encrypted, refresh_token_encrypted, config, items_indexed, created_at, updated_at)
      VALUES (?, ?, 'slack', 'active', ?, ?, ?, 0, datetime('now'), datetime('now'))
      ON CONFLICT(workspace_id, provider) DO UPDATE SET
        access_token_encrypted = excluded.access_token_encrypted,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        config = excluded.config,
        status = 'active',
        updated_at = datetime('now')
    `).bind(integrationId, workspace_id, accessTokenEncrypted, refreshTokenEncrypted, config).run()

    return c.redirect(`${c.env.WEB_URL}/settings?success=slack_connected`)
  } catch (err) {
    console.error('Slack OAuth error:', err)
    return c.redirect(`${c.env.WEB_URL}/settings?error=oauth_failed`)
  }
})

// ============================================
// GOOGLE OAUTH (Drive + Gmail)
// ============================================

// Start Google OAuth flow for Drive/Gmail
integrations.get('/google/connect', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  // Request scopes (query param can specify which services)
  const services = c.req.query('services')?.split(',') || ['drive']

  const scopes: string[] = []
  if (services.includes('drive')) {
    scopes.push('https://www.googleapis.com/auth/drive.readonly')
  }
  if (services.includes('gmail')) {
    scopes.push('https://www.googleapis.com/auth/gmail.readonly')
  }

  // Always need basic profile for user info
  scopes.push('openid', 'email', 'profile')

  const state = encodeState({
    workspace_id: user.workspace_id,
    user_id: user.id,
    services,
    timestamp: Date.now(),
  })

  const redirectUri = `${c.env.WORKER_URL}/api/integrations/google/callback`
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')

  return c.json({ authUrl: authUrl.toString() })
})

// Google OAuth callback
integrations.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.redirect(`${c.env.WEB_URL}/settings?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return c.redirect(`${c.env.WEB_URL}/settings?error=missing_params`)
  }

  try {
    // Decode state
    const stateData = decodeState(state)
    const { workspace_id, services } = stateData

    // Verify state isn't too old (15 minutes)
    if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
      return c.redirect(`${c.env.WEB_URL}/settings?error=state_expired`)
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${c.env.WORKER_URL}/api/integrations/google/callback`,
      }),
    })

    const tokenData = await tokenResponse.json() as any

    if (tokenData.error) {
      console.error('Google token error:', tokenData)
      return c.redirect(`${c.env.WEB_URL}/settings?error=token_exchange_failed`)
    }

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userInfo = await userInfoResponse.json() as any

    // Encrypt tokens
    const accessTokenEncrypted = await encrypt(tokenData.access_token, c.env.ENCRYPTION_KEY)
    const refreshTokenEncrypted = tokenData.refresh_token
      ? await encrypt(tokenData.refresh_token, c.env.ENCRYPTION_KEY)
      : null

    // Create integrations for each service
    for (const service of services) {
      const provider = service === 'drive' ? 'google_drive' : 'gmail'
      const integrationId = crypto.randomUUID()
      const config = JSON.stringify({
        google_user_id: userInfo.id,
        google_email: userInfo.email,
        google_name: userInfo.name,
        services,
      })

      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null

      await c.env.DB.prepare(`
        INSERT INTO integrations (id, workspace_id, provider, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, config, items_indexed, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
        ON CONFLICT(workspace_id, provider) DO UPDATE SET
          access_token_encrypted = excluded.access_token_encrypted,
          refresh_token_encrypted = excluded.refresh_token_encrypted,
          token_expires_at = excluded.token_expires_at,
          config = excluded.config,
          status = 'active',
          updated_at = datetime('now')
      `).bind(integrationId, workspace_id, provider, accessTokenEncrypted, refreshTokenEncrypted, expiresAt, config).run()
    }

    const successParam = services.length > 1 ? 'google_connected' : `${services[0]}_connected`
    return c.redirect(`${c.env.WEB_URL}/settings?success=${successParam}`)
  } catch (err) {
    console.error('Google OAuth error:', err)
    return c.redirect(`${c.env.WEB_URL}/settings?error=oauth_failed`)
  }
})

// ============================================
// HUBSPOT (Private Access Token)
// ============================================

// Connect HubSpot using the workspace's private access token
integrations.post('/hubspot/connect', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.workspace_id) return c.json({ error: 'No workspace' }, 400)

  // HubSpot uses a private access token stored as a secret
  // No OAuth flow needed - just create the integration
  if (!c.env.HUBSPOT_ACCESS_TOKEN) {
    return c.json({ error: 'HubSpot access token not configured' }, 400)
  }

  try {
    // Verify the token works by making a test API call
    const testResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
      headers: {
        Authorization: `Bearer ${c.env.HUBSPOT_ACCESS_TOKEN}`,
      },
    })

    if (!testResponse.ok) {
      return c.json({ error: 'Invalid HubSpot access token' }, 400)
    }

    // Create the integration
    const integrationId = crypto.randomUUID()

    await c.env.DB.prepare(`
      INSERT INTO integrations (id, workspace_id, provider, status, items_indexed, created_at, updated_at)
      VALUES (?, ?, 'hubspot', 'active', 0, datetime('now'), datetime('now'))
      ON CONFLICT(workspace_id, provider) DO UPDATE SET
        status = 'active',
        updated_at = datetime('now')
    `).bind(integrationId, user.workspace_id).run()

    return c.json({ success: true, message: 'HubSpot connected' })
  } catch (err) {
    console.error('HubSpot connect error:', err)
    return c.json({ error: 'Failed to connect HubSpot' }, 500)
  }
})

export default integrations
