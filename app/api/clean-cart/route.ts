import { NextRequest } from 'next/server'
import { cleanCart } from '@/lib/tinyfish-service'

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

  const send = (data: any) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  ;(async () => {
    try {
      await send({ type: 'HEARTBEAT' })
      await send({ type: 'PROGRESS', text: 'Initializing autonomous proxy session...' })

      const result = await cleanCart(
        url.trim(),
        query.trim(),
        (message, level) => {
          // Map to expected frontend formats
          if (level === 'action') {
            send({ type: 'ACTION', action: 'executing', text: message })
          } else {
            send({ message, type: level })
          }
        },
        (streamUrl) => {
          send({ type: 'STREAMING_URL', url: streamUrl })
        },
      )
      
      // Spatial validation injection for the frontend
      const finalResult = {
        ...result,
        spatialValidation: result.spatialValidation,
      }

      send({
        type: 'COMPLETE',
        status: 'COMPLETED',
        resultJson: JSON.stringify(finalResult),
      })
    } catch (err) {
      send({ message: err instanceof Error ? err.message : 'Cart clean failed', type: 'error' })
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