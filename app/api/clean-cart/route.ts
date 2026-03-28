import { NextRequest } from 'next/server'
import { cleanCart } from '@/lib/tinyfish-service'
import type { CleanCartEvent } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { query } = await req.json()

  if (!query || typeof query !== 'string' || !query.trim()) {
    return new Response(JSON.stringify({ error: 'query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()

  const send = (event: CleanCartEvent) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }

  ;(async () => {
    try {
      const result = await cleanCart(
        query.trim(),
        (message, level) => send({ type: 'log', message, level }),
        (url) => send({ type: 'stream_url', url }),
      )
      send({ type: 'result', data: result })
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : 'Cart clean failed' })
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
