import { Hono } from 'hono'
import { cors } from 'hono/cors'
import auth from './routes/auth'
import groups from './routes/groups'
import messages from './routes/messages'
import brain from './routes/brain'
import settings from './routes/settings'
import documents from './routes/documents'
import { ChatRoom } from './durable-objects/ChatRoom'
import type { Env } from './types'

// Export Durable Object
export { ChatRoom }

const app = new Hono<{ Bindings: Env }>()

// CORS middleware
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
)

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Mount routes
app.route('/api/auth', auth)
app.route('/api/groups', groups)
app.route('/api', messages) // messages routes use /groups/:id/messages path
app.route('/api/brain', brain)
app.route('/api/settings', settings)
app.route('/api/documents', documents)

// WebSocket endpoint for chat rooms
app.get('/api/ws/:groupId', async (c) => {
  const groupId = c.req.param('groupId')

  // Verify user is a member (basic check via query param for now)
  // In production, you'd verify the JWT here

  // Get or create the Durable Object for this group
  const id = c.env.CHAT_ROOMS.idFromName(groupId)
  const room = c.env.CHAT_ROOMS.get(id)

  // Forward the request to the Durable Object
  return room.fetch(c.req.raw)
})

// 404 handler
app.notFound((c) => {
  return c.json({ message: 'Not found' }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ message: 'Internal server error' }, 500)
})

export default app
