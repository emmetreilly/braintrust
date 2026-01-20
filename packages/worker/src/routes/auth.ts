import { Hono } from 'hono'
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../lib/auth'
import type { Env, User } from '../types'

const auth = new Hono<{ Bindings: Env }>()

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

    // Create user
    const id = crypto.randomUUID()
    const passwordHash = await hashPassword(password)

    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, name, interests) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(id, email.toLowerCase(), passwordHash, name, '[]')
      .run()

    const user: User = {
      id,
      email: email.toLowerCase(),
      name,
      interests: [],
      created_at: new Date().toISOString(),
    }

    const token = await generateToken(user, c.env.JWT_SECRET)

    return c.json({ user, token })
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

    const row = await c.env.DB.prepare(
      'SELECT id, email, password_hash, name, avatar_url, interests, created_at FROM users WHERE email = ?'
    )
      .bind(email.toLowerCase())
      .first<{
        id: string
        email: string
        password_hash: string
        name: string
        avatar_url: string | null
        interests: string
        created_at: string
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
    }

    const token = await generateToken(user, c.env.JWT_SECRET)

    return c.json({ user, token })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ message: 'Failed to login' }, 500)
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

    const row = await c.env.DB.prepare(
      'SELECT id, email, name, avatar_url, interests, created_at FROM users WHERE id = ?'
    )
      .bind(payload.sub)
      .first<{
        id: string
        email: string
        name: string
        avatar_url: string | null
        interests: string
        created_at: string
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
    }

    return c.json({ user })
  } catch (error) {
    console.error('Get user error:', error)
    return c.json({ message: 'Failed to get user' }, 500)
  }
})

export default auth
