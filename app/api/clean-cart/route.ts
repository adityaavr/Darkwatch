import { NextRequest } from 'next/server'
import { cleanCart } from '@/lib/tinyfish-service'
import type { CleanCartEvent } from '@/lib/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { url, query } = await req.json()

  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'url is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
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
        url.trim(),
        query.trim(),
        (message, level) => send({ type: 'log', message, level }),
        (streamUrl) => send({ type: 'stream_url', url: streamUrl }),
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
