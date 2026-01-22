import type { Env } from '../types'

interface Session {
  webSocket: WebSocket
  userId: string
  userName: string
}

interface WebSocketMessage {
  type: 'message' | 'reaction' | 'typing' | 'presence'
  [key: string]: any
}

export class ChatRoom {
  private sessions: Map<string, Session> = new Map()
  private state: DurableObjectState
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle internal broadcast from other workers (for notifications)
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      try {
        const data = await request.json() as WebSocketMessage
        this.broadcast(data)
        return new Response('OK', { status: 200 })
      } catch (e) {
        console.error('Broadcast error:', e)
        return new Response('Broadcast failed', { status: 500 })
      }
    }

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      const userId = url.searchParams.get('userId')
      const userName = url.searchParams.get('userName') || 'Anonymous'

      if (!userId) {
        return new Response('Missing userId', { status: 400 })
      }

      await this.handleSession(server, userId, userName)

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    return new Response('Expected WebSocket', { status: 400 })
  }

  private async handleSession(webSocket: WebSocket, userId: string, userName: string) {
    // Accept the WebSocket
    webSocket.accept()

    const sessionId = crypto.randomUUID()

    this.sessions.set(sessionId, {
      webSocket,
      userId,
      userName,
    })

    // Broadcast that user joined
    this.broadcast(
      {
        type: 'presence',
        action: 'joined',
        userId,
        userName,
        online: this.getOnlineUsers(),
      },
      sessionId
    )

    // Handle incoming messages
    webSocket.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string) as WebSocketMessage

        switch (data.type) {
          case 'message':
            // Broadcast message to all clients
            this.broadcast({
              type: 'message',
              message: data.message,
            })

            // Check for @brain mention
            if (
              data.message?.content &&
              data.message.content.toLowerCase().includes('@brain')
            ) {
              await this.handleBrainMention(data.message)
            }
            break

          case 'reaction':
            // Broadcast reaction to all clients
            this.broadcast({
              type: 'reaction',
              messageId: data.messageId,
              reaction: data.reaction,
            })
            break

          case 'typing':
            // Broadcast typing indicator (exclude sender)
            this.broadcast(
              {
                type: 'typing',
                userId: data.userId,
                userName: data.userName,
              },
              sessionId
            )
            break
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    })

    // Handle close
    webSocket.addEventListener('close', () => {
      this.sessions.delete(sessionId)

      this.broadcast({
        type: 'presence',
        action: 'left',
        userId,
        online: this.getOnlineUsers(),
      })
    })

    // Handle errors
    webSocket.addEventListener('error', () => {
      this.sessions.delete(sessionId)
    })
  }

  private broadcast(message: WebSocketMessage, excludeSession?: string) {
    const payload = JSON.stringify(message)

    for (const [id, session] of this.sessions) {
      if (id !== excludeSession) {
        try {
          session.webSocket.send(payload)
        } catch {
          // Remove dead sessions
          this.sessions.delete(id)
        }
      }
    }
  }

  private getOnlineUsers(): string[] {
    return [...new Set([...this.sessions.values()].map((s) => s.userId))]
  }

  private async handleBrainMention(message: any) {
    // This will be called when someone mentions @brain
    // The actual API call happens through the /api/brain/respond endpoint
    // which the frontend calls. Here we just need to broadcast the response
    // when it comes back.

    // For now, we could make an internal call to trigger Brain's response
    // but this is handled client-side for simplicity in the initial implementation
  }
}
