import { Hono } from 'hono'
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../lib/auth'
import type { Env, User } from '../types'

const auth = new Hono<{ Bindings: Env }>()

// Personal email domains to block
const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'live.com',
  'msn.com',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'fastmail.com',
]

function isWorkEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return !PERSONAL_EMAIL_DOMAINS.includes(domain)
}

function getEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || ''
}

function getWorkspaceNameFromDomain(domain: string): string {
  // Extract company name from domain (e.g., 'kartel.com' -> 'Kartel')
  const name = domain.split('.')[0]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Signup
auth.post('/signup', async (c) => {
  try {
    const { email, password, name } = await c.req.json<{
      email: string
      password: string
      name: string
    }>()

    if (!email || !password || !name) {
      return c.json({ message: 'Email, password, and name are required' }, 400)
    }

    if (!isWorkEmail(email)) {
      return c.json({ message: 'Please use your work email address' }, 400)
    }

    if (password.length < 8) {
      return c.json({ message: 'Password must be at least 8 characters' }, 400)
    }

    // Check if user exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    )
      .bind(email.toLowerCase())
      .first()

    if (existing) {
      return c.json({ message: 'Email already registered' }, 400)
    }

    const domain = getEmailDomain(email)

    // Auto-create or get workspace based on email domain
    let workspace = await c.env.DB.prepare(
      'SELECT id, name FROM workspaces WHERE domain = ?'
    )
      .bind(domain)
      .first<{ id: string; name: string }>()

    if (!workspace) {
      // Create new workspace for this domain
      const workspaceId = crypto.randomUUID()
      const workspaceName = getWorkspaceNameFromDomain(domain)

      await c.env.DB.prepare(
        'INSERT INTO workspaces (id, domain, name) VALUES (?, ?, ?)'
      )
        .bind(workspaceId, domain, workspaceName)
        .run()

      workspace = { id: workspaceId, name: workspaceName }
    }

    // Create user with workspace
    const id = crypto.randomUUID()
    const passwordHash = await hashPassword(password)

    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, name, interests, workspace_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, email.toLowerCase(), passwordHash, name, '[]', workspace.id)
      .run()

    // Auto-join user to all existing workspace channels
    const workspaceGroups = await c.env.DB.prepare(
      'SELECT id FROM groups WHERE workspace_id = ?'
    )
      .bind(workspace.id)
      .all()

    for (const group of (workspaceGroups.results || [])) {
      try {
        await c.env.DB.prepare(
          'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'
        )
          .bind((group as { id: string }).id, id, 'member')
          .run()
      } catch {
        // Ignore if already a member
      }
    }

    const user: User = {
      id,
      email: email.toLowerCase(),
      name,
      interests: [],
      created_at: new Date().toISOString(),
      workspace_id: workspace.id,
      workspace_name: workspace.name,
    }

    const token = await generateToken(user, c.env.JWT_SECRET)

    return c.json({ user, token, workspace })
  } catch (error) {
    console.error('Signup error:', error)
    return c.json({ message: 'Failed to create account' }, 500)
  }
})

// Login
auth.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json<{
      email: string
      password: string
    }>()

    if (!email || !password) {
      return c.json({ message: 'Email and password are required' }, 400)
    }

    const row = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.password_hash, u.name, u.avatar_url, u.interests, u.created_at, u.workspace_id, w.name as workspace_name
      FROM users u
      LEFT JOIN workspaces w ON u.workspace_id = w.id
      WHERE u.email = ?
    `)
      .bind(email.toLowerCase())
      .first<{
        id: string
        email: string
        password_hash: string
        name: string
        avatar_url: string | null
        interests: string
        created_at: string
        workspace_id: string | null
        workspace_name: string | null
      }>()

    if (!row) {
      return c.json({ message: 'Invalid email or password' }, 401)
    }

    const valid = await verifyPassword(password, row.password_hash)
    if (!valid) {
      return c.json({ message: 'Invalid email or password' }, 401)
    }

    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatar_url || undefined,
      interests: JSON.parse(row.interests || '[]'),
      created_at: row.created_at,
      workspace_id: row.workspace_id || undefined,
      workspace_name: row.workspace_name || undefined,
    }

    const token = await generateToken(user, c.env.JWT_SECRET)

    // Get workspace info if exists
    let workspace = null
    if (row.workspace_id) {
      workspace = { id: row.workspace_id, name: row.workspace_name }
    }

    return c.json({ user, token, workspace })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ message: 'Failed to login' }, 500)
  }
})

// Google OAuth - initiate
auth.get('/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return c.json({ message: 'Google OAuth not configured' }, 500)
  }

  const redirectUri = `${c.env.WORKER_URL || 'https://brain-trust-worker.e-caa.workers.dev'}/api/auth/google/callback`
  const scope = 'openid email profile'
  const state = crypto.randomUUID() // Could store this for CSRF protection

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', scope)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('hd', 'kartel.ai') // Restrict to kartel.ai domain

  return c.redirect(authUrl.toString())
})

// Google OAuth - callback
auth.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) {
    return c.redirect(`${c.env.WEB_URL || 'https://brain-trust.pages.dev'}/login?error=no_code`)
  }

  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  const redirectUri = `${c.env.WORKER_URL || 'https://brain-trust-worker.e-caa.workers.dev'}/api/auth/google/callback`

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', await tokenResponse.text())
      return c.redirect(`${c.env.WEB_URL || 'https://brain-trust.pages.dev'}/login?error=token_failed`)
    }

    const tokens = await tokenResponse.json() as { access_token: string; id_token: string }

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userInfoResponse.ok) {
      return c.redirect(`${c.env.WEB_URL || 'https://brain-trust.pages.dev'}/login?error=userinfo_failed`)
    }

    const googleUser = await userInfoResponse.json() as {
      id: string
      email: string
      name: string
      picture?: string
      hd?: string // hosted domain
    }

    // Verify domain is kartel.ai
    if (googleUser.hd !== 'kartel.ai') {
      return c.redirect(`${c.env.WEB_URL || 'https://brain-trust.pages.dev'}/login?error=invalid_domain`)
    }

    const email = googleUser.email.toLowerCase()
    const domain = getEmailDomain(email)

    // Get or create workspace
    let workspace = await c.env.DB.prepare(
      'SELECT id, name FROM workspaces WHERE domain = ?'
    )
      .bind(domain)
      .first<{ id: string; name: string }>()

    if (!workspace) {
      const workspaceId = crypto.randomUUID()
      const workspaceName = getWorkspaceNameFromDomain(domain)

      await c.env.DB.prepare(
        'INSERT INTO workspaces (id, domain, name) VALUES (?, ?, ?)'
      )
        .bind(workspaceId, domain, workspaceName)
        .run()

      workspace = { id: workspaceId, name: workspaceName }
    }

    // Get or create user
    let userRow = await c.env.DB.prepare(
      'SELECT id, email, name, avatar_url, interests, created_at, workspace_id FROM users WHERE email = ?'
    )
      .bind(email)
      .first<{
        id: string
        email: string
        name: string
        avatar_url: string | null
        interests: string
        created_at: string
        workspace_id: string | null
      }>()

    if (!userRow) {
      // Create new user
      const userId = crypto.randomUUID()
      await c.env.DB.prepare(
        'INSERT INTO users (id, email, password_hash, name, avatar_url, interests, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(userId, email, 'GOOGLE_OAUTH_USER', googleUser.name, googleUser.picture || null, '[]', workspace.id)
        .run()

      // Auto-join user to all existing workspace channels
      const workspaceGroups = await c.env.DB.prepare(
        'SELECT id FROM groups WHERE workspace_id = ?'
      )
        .bind(workspace.id)
        .all()

      for (const group of (workspaceGroups.results || [])) {
        try {
          await c.env.DB.prepare(
            'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'
          )
            .bind((group as { id: string }).id, userId, 'member')
            .run()
        } catch {
          // Ignore if already a member
        }
      }

      userRow = {
        id: userId,
        email,
        name: googleUser.name,
        avatar_url: googleUser.picture || null,
        interests: '[]',
        created_at: new Date().toISOString(),
        workspace_id: workspace.id,
      }
    } else {
      // Update avatar if changed
      if (googleUser.picture && googleUser.picture !== userRow.avatar_url) {
        await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
          .bind(googleUser.picture, userRow.id)
          .run()
      }
    }

    const user: User = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      avatar_url: userRow.avatar_url || googleUser.picture || undefined,
      interests: JSON.parse(userRow.interests || '[]'),
      created_at: userRow.created_at,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
    }

    const token = await generateToken(user, c.env.JWT_SECRET)

    // Redirect to frontend with token
    return c.redirect(`${c.env.WEB_URL || 'https://brain-trust.pages.dev'}/login?token=${token}`)
  } catch (error) {
    console.error('Google OAuth error:', error)
    return c.redirect(`${c.env.WEB_URL || 'https://brain-trust.pages.dev'}/login?error=oauth_failed`)
  }
})

// Get current user
auth.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ message: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice(7)
    const payload = await verifyToken(token, c.env.JWT_SECRET)

    if (!payload) {
      return c.json({ message: 'Invalid token' }, 401)
    }

    const row = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.avatar_url, u.interests, u.created_at, u.workspace_id, w.name as workspace_name
      FROM users u
      LEFT JOIN workspaces w ON u.workspace_id = w.id
      WHERE u.id = ?
    `)
      .bind(payload.sub)
      .first<{
        id: string
        email: string
        name: string
        avatar_url: string | null
        interests: string
        created_at: string
        workspace_id: string | null
        workspace_name: string | null
      }>()

    if (!row) {
      return c.json({ message: 'User not found' }, 404)
    }

    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatar_url || undefined,
      interests: JSON.parse(row.interests || '[]'),
      created_at: row.created_at,
      workspace_id: row.workspace_id || undefined,
      workspace_name: row.workspace_name || undefined,
    }

    // Get workspace info if exists
    let workspace = null
    if (row.workspace_id) {
      workspace = { id: row.workspace_id, name: row.workspace_name }
    }

    return c.json({ user, workspace })
  } catch (error) {
    console.error('Get user error:', error)
    return c.json({ message: 'Failed to get user' }, 500)
  }
})

export default auth
