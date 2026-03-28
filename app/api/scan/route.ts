import { NextRequest } from 'next/server'
import { fetchPageTwice, compareProfiles, getCheckoutAnalysis, getVisualDarkPatterns } from '@/lib/browser'
import { analyzeSnapshot, buildSnapshot, extractSocialProof, extractScarcity, extractTimers, getTrustScore, getEthicalAnalysis, getActionRecommendation } from '@/lib/ai'
import type { ScanEvent } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { url, productQuery } = await req.json()
  const product: string = typeof productQuery === 'string' ? productQuery.trim() : ''

  // Validate and normalize URL
  let normalizedUrl: string = url?.trim() ?? ''
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl
  }
  try {
    new URL(normalizedUrl)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const domain = new URL(normalizedUrl).hostname.replace('www.', '')
  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()

  const send = (event: ScanEvent) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }

  // Parse "MM:SS" or "HH:MM:SS" to total seconds for numeric comparison
  function timerToSeconds(t: string): number {
    const parts = t.split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return parts[0] * 60 + (parts[1] ?? 0)
  }

  // Run scan async — do not await
  ;(async () => {
    try {
      // ── Kick off parallel tasks immediately ─────────────────────────────────
      // All run concurrently with the 8s fetch gap
      const profilePromise = compareProfiles(
        normalizedUrl,
        (msg) => send({ type: 'log', message: msg }),
      )
      const trustPromise = getTrustScore(
        domain,
        (msg) => send({ type: 'log', message: msg }),
      )
      const checkoutPromise = getCheckoutAnalysis(
        normalizedUrl,
        product,
        (msg) => send({ type: 'log', message: msg }),
      )
      const visualPromise = getVisualDarkPatterns(
        normalizedUrl,
        (msg) => send({ type: 'log', message: msg }),
      )
      // Ethical analysis needs the main page text — resolved after first fetch
      // We defer it until html1 is ready but still run in parallel with the 8s gap

      // ── Main scan (has internal 8s wait) ────────────────────────────────────
      const { html1, html2 } = await fetchPageTwice(
        normalizedUrl,
        8000,
        (msg) => send({ type: 'log', message: msg }),
        (value) => send({ type: 'progress', value }),
        (url) => send({ type: 'stream_url', url }),
      )

      // Kick off ethical analysis as soon as we have html1 (runs during AI analysis)
      const { extractText } = await import('@/lib/ai')
      const ethicsPromise = getEthicalAnalysis(
        normalizedUrl,
        extractText(html1),
        (msg) => send({ type: 'log', message: msg }),
      )

      // Surface what we found in the two fetches
      const timers1 = extractTimers(html1)
      const timers2 = extractTimers(html2)
      const socialProof = extractSocialProof(html1)
      const scarcity = extractScarcity(html1)

      if (timers1.length > 0) {
        const resetPair = timers1.reduce<{ t1: string; t2: string } | null>((found, t1, i) => {
          if (found) return found
          const t2 = timers2[i]
          return t2 && timerToSeconds(t2) > timerToSeconds(t1) ? { t1, t2 } : null
        }, null)

        send({
          type: 'log',
          message: resetPair
            ? `⚠ Timer reset detected — ${resetPair.t1} → ${resetPair.t2} (confirms fake countdown)`
            : `Found ${timers1.length} timer(s) — values decreased normally, no reset`,
        })
      } else {
        send({ type: 'log', message: 'No countdown timers found on page' })
      }

      if (socialProof.length > 0) {
        send({
          type: 'log',
          message: `Found ${socialProof.length} social proof claim(s) — e.g. "${socialProof[0].slice(0, 50)}"`,
        })
      }
      if (scarcity.length > 0) {
        send({
          type: 'log',
          message: `Found ${scarcity.length} scarcity claim(s) — e.g. "${scarcity[0].slice(0, 50)}"`,
        })
      }

      send({ type: 'progress', value: 65 })
      send({ type: 'log', message: 'Sending to AI for pattern classification...' })
      send({ type: 'progress', value: 75 })

      const snapshot = buildSnapshot(normalizedUrl, html1, html2)
      const result = await analyzeSnapshot(snapshot)

      // ── Collect parallel results ─────────────────────────────────────────────
      const [profileSettled, trustSettled, ethicsSettled, checkoutSettled, visualSettled] =
        await Promise.allSettled([
          profilePromise,
          trustPromise,
          ethicsPromise,
          checkoutPromise,
          visualPromise,
        ])

      if (profileSettled.status === 'fulfilled') {
        result.profileComparison = profileSettled.value
      }
      if (trustSettled.status === 'fulfilled') {
        result.trustScore = trustSettled.value
      }
      if (ethicsSettled.status === 'fulfilled') {
        result.ethicalAnalysis = ethicsSettled.value
      }
      if (checkoutSettled.status === 'fulfilled') {
        result.checkoutAnalysis = checkoutSettled.value
      }
      if (visualSettled.status === 'fulfilled') {
        result.visualDarkPatterns = visualSettled.value
      }

      // ── Build action recommendation from all gathered data ───────────────────
      send({ type: 'log', message: 'Building action recommendation...' })
      try {
        result.actionRecommendation = await getActionRecommendation(
          normalizedUrl,
          product,
          result,
          (msg) => send({ type: 'log', message: msg }),
        )
      } catch {
        // non-fatal — result still sent without recommendation
      }

      send({ type: 'progress', value: 100 })
      send({
        type: 'log',
        message:
          result.patterns.length > 0
            ? `Analysis complete — ${result.patterns.length} pattern(s) detected`
            : `Analysis complete — no dark patterns detected`,
      })
      send({ type: 'result', data: result })
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : 'Scan failed' })
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
