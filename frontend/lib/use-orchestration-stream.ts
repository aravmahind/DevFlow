'use client'

import { useEffect, useRef, useCallback } from 'react'
import { getAuthToken, getProject, streamUrl } from './api'
import { useProjectStore } from './project-store'
import type { OrchestrationEvent } from './project-types'

/**
 * Connects to the backend WebSocket for a project, applies streamed
 * orchestration events to the project store, and refetches the authoritative
 * document once the run completes.
 *
 * Includes:
 * - Automatic reconnection with exponential backoff on disconnect
 * - Polling fallback every 5s to keep the UI in sync if WS is flaky
 * - Heartbeat detection to catch silent WS deaths
 */
export function useOrchestrationStream(projectId: string | null) {
  const applyEvent = useProjectStore((s) => s.applyEvent)
  const setProject = useProjectStore((s) => s.setProject)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 10

  // Stable polling fallback: refetch project every 5s for statuses that are in-flight
  useEffect(() => {
    if (!projectId) return
    const poll = setInterval(async () => {
      try {
        const doc = await getProject(projectId)
        setProject(doc)
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => clearInterval(poll)
  }, [projectId, setProject])

  // WebSocket connection with reconnection
  useEffect(() => {
    if (!projectId) return
    let closed = false
    let refetchTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined

    // Initial snapshot fetch
    getProject(projectId)
      .then((doc) => {
        if (!closed) setProject(doc)
      })
      .catch(() => {})

    const connect = async () => {
      if (closed) return
      try {
        const token = await getAuthToken()
        if (closed || !token) return

        const ws = new WebSocket(streamUrl(projectId, token))
        wsRef.current = ws

        // Reset heartbeat on any message
        const resetHeartbeat = () => {
          clearTimeout(heartbeatTimer)
          heartbeatTimer = setTimeout(() => {
            // No message for 30s — connection is likely dead
            console.warn('[WS] Heartbeat timeout, reconnecting...')
            try { ws.close() } catch { /* ignore */ }
          }, 30000)
        }

        ws.onopen = () => {
          console.log('[WS] Connected to project stream')
          reconnectAttempts.current = 0
          resetHeartbeat()
        }

        ws.onmessage = (e) => {
          resetHeartbeat()
          let evt: OrchestrationEvent
          try {
            evt = JSON.parse(e.data)
          } catch {
            return
          }
          applyEvent(evt)
          if (evt.type === 'run_complete' || evt.type === 'stream_end') {
            clearTimeout(refetchTimer)
            refetchTimer = setTimeout(() => {
              if (!closed) getProject(projectId).then(setProject).catch(() => {})
            }, 500)
          }
        }

        ws.onerror = (err) => {
          console.warn('[WS] Error:', err)
        }

        ws.onclose = (e) => {
          clearTimeout(heartbeatTimer)
          wsRef.current = null
          if (closed) return

          // Don't reconnect if the server closed it gracefully (stream_end)
          if (e.code === 1000) return

          // Exponential backoff reconnection
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 15000)
            console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`)
            reconnectAttempts.current++
            reconnectTimer = setTimeout(() => {
              if (!closed) connect()
            }, delay)
          } else {
            console.warn('[WS] Max reconnection attempts reached, relying on polling fallback')
          }
        }
      } catch (err) {
        console.warn('[WS] Connection setup failed:', err)
        // Retry after a delay
        if (!closed && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 15000)
          reconnectAttempts.current++
          reconnectTimer = setTimeout(() => {
            if (!closed) connect()
          }, delay)
        }
      }
    }

    void connect()

    return () => {
      closed = true
      clearTimeout(refetchTimer)
      clearTimeout(reconnectTimer)
      clearTimeout(heartbeatTimer)
      try {
        wsRef.current?.close()
      } catch {
        /* ignore */
      }
      wsRef.current = null
    }
  }, [projectId, applyEvent, setProject])
}
