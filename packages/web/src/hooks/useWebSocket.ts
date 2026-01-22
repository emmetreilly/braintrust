import { useState, useEffect, useRef, useCallback } from 'react'
import type { WebSocketMessage } from '../types'

export function useWebSocket(groupId: string, userId: string) {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5

  useEffect(() => {
    if (!groupId || !userId) return

    const connect = () => {
      // Use the worker URL for WebSocket in production
      const isProduction = window.location.hostname.includes('pages.dev') || window.location.hostname.includes('brain-trust')
      const workerHost = 'brain-trust-worker.e-caa.workers.dev'
      const host = isProduction ? workerHost : window.location.host
      const protocol = isProduction ? 'wss:' : (window.location.protocol === 'https:' ? 'wss:' : 'ws:')
      const wsUrl = `${protocol}//${host}/api/ws/${groupId}?userId=${userId}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        reconnectAttempts.current = 0
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketMessage
          setLastMessage(data)
        } catch {
          console.error('Failed to parse WebSocket message')
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        wsRef.current = null

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
          reconnectAttempts.current++
          setTimeout(connect, delay)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      reconnectAttempts.current = maxReconnectAttempts // Prevent reconnection on unmount
      wsRef.current?.close()
    }
  }, [groupId, userId])

  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  return { sendMessage, lastMessage, isConnected }
}
