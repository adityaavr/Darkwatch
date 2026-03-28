import { NextRequest } from 'next/server'
import { cleanCart } from '@/lib/tinyfish-service'
import { synthesiseAction, getTrustScore } from '@/lib/ai'
import type { ScanResult, ScanEvent } from '@/lib/types'
import type { SanitizationResult } from '@/lib/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { url, productQuery } = await req.json()

  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'url is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let normalizedUrl = url.trim()
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl
  }
  try { new URL(normalizedUrl) } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const query: string =
    typeof productQuery === 'string' && productQuery.trim()
      ? productQuery.trim()
      : 'product'

  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()

  const send = (event: ScanEvent) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }

  ;(async () => {
    try {
      send({ type: 'progress', value: 5 })

      const domain = new URL(normalizedUrl).hostname.replace('www.', '')

      send({ type: 'log', message: `Agent launching — trust check running in parallel for ${domain}` })

      // ── Trust check fires immediately in background — does NOT block the result ──
      const trustPromise = getTrustScore(
        domain,
        (msg) => send({ type: 'log', message: msg }),
        (streamUrl) => send({ type: 'stream_url', url: streamUrl, label: '🔍 REDDIT AGENT · Community Reviews' }),
        (source, status, finding) => send({ type: 'trust_check', source, status, finding }),
      ).catch(() => null)

      // ── Phase 1: TinyFish cart agent ──────────────────────────────────────
      const sanitization = await cleanCart(
        normalizedUrl,
        query,
        (message) => send({ type: 'log', message }),
        (streamUrl) => send({ type: 'stream_url', url: streamUrl, label: `🛒 CART AGENT · ${domain}` }),
      )

      send({ type: 'progress', value: 80 })

      // ── Phase 2: GPT-4o synthesis — runs immediately, no waiting for trust ─
      send({ type: 'log', message: 'Sending findings to GPT-4o for verdict synthesis...' })

      const baseScanResult = buildScanResult(sanitization)

      try {
        baseScanResult.actionRecommendation = await synthesiseAction(
          sanitization,
          query,
          (msg) => send({ type: 'log', message: msg }),
        )
      } catch {
        send({ type: 'log', message: 'AI synthesis unavailable — using rule-based verdict' })
        baseScanResult.actionRecommendation = fallbackRec(sanitization, query)
      }

      // ── Stream result immediately — user sees verdict now ─────────────────
      send({ type: 'progress', value: 100 })
      send({ type: 'result', data: baseScanResult })

      // ── Trust check patch — push update when it lands (non-blocking) ──────
      const externalTrust = await trustPromise
      if (externalTrust) {
        send({ type: 'log', message: `Trust check complete — ${externalTrust.verdict} (${externalTrust.trust_score}/100)` })
        send({ type: 'update', data: { trustScore: externalTrust } })
      }
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

// ── Build ScanResult shell from SanitizationResult ────────────────────────────

function buildScanResult(s: SanitizationResult): ScanResult {
  const fees = s.junkFeesRemoved ?? []

  const riskScore = Math.min(
    98,
    fees.length * 20 +
      (s.fakeReviewsDetected ? 20 : 0) +
      (s.productOrigin?.isDropshipped ? 15 : 0),
  )

  const verdict: ScanResult['verdict'] =
    riskScore >= 60 ? 'high risk' :
    riskScore >= 35 ? 'medium risk' :
    riskScore >= 10 ? 'low risk' : 'clean'

  return {
    risk_score: riskScore,
    verdict,
    patterns: fees.map((f) => ({
      pattern: f.name,
      severity: 'critical' as const,
      evidence: f.amount,
      explanation: f.description,
    })),
    // Placeholder trust score from on-page signals only.
    // Gets replaced by externalTrust (Reddit + Trustpilot) if that call succeeds.
    trustScore: s.trustScore != null
      ? {
          trust_score: s.trustScore,
          verdict:
            s.trustScore >= 70 ? 'trusted' :
            s.trustScore >= 45 ? 'caution' :
            s.trustScore >= 25 ? 'suspicious' : 'dangerous',
          signals: s.fakeReviewsDetected
            ? ['Fake or incentivised reviews detected on the product page']
            : ['On-page reviews appear genuine — no fake signals detected'],
          sources_checked: ['Product page reviews (TinyFish agent)'],
        }
      : undefined,
    // actionRecommendation is filled in by synthesiseAction after this
  }
}

// ── Rule-based fallback (used if GPT-4o call fails) ──────────────────────────

function fallbackRec(s: SanitizationResult, query: string) {
  const fees = s.junkFeesRemoved ?? []
  const isDropshipped = s.productOrigin?.isDropshipped ?? false
  const wholesale = s.productOrigin?.wholesalePriceEstimate ?? ''
  const markup = s.productOrigin?.markupPercentage ?? ''
  const totalSaved = fees.reduce(
    (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, '') || '0'),
    0,
  )

  const verdict =
    fees.length > 0 && isDropshipped ? 'skip' :
    fees.length > 0 || isDropshipped || s.fakeReviewsDetected ? 'sketchy' : 'safe'

  const findings: string[] = []
  if (fees.length > 0)
    findings.push(`${fees.length} junk fee${fees.length > 1 ? 's' : ''} stripped — saved $${totalSaved.toFixed(2)}`)
  if (isDropshipped && markup)
    findings.push(`${markup} markup on a ${wholesale} wholesale product`)
  if (s.fakeReviewsDetected)
    findings.push('Fake or incentivised reviews detected')

  return {
    verdict: verdict as 'safe' | 'sketchy' | 'skip',
    headline:
      isDropshipped && markup ? `${markup} markup — buy direct for ${wholesale}` :
      fees.length > 0 ? `$${totalSaved.toFixed(2)} in junk fees stripped` :
      `True price: ${s.finalPrice}`,
    topFindings: findings.slice(0, 3),
    ctaLabel: isDropshipped && wholesale ? `Buy direct for ${wholesale} →` : `True price: ${s.finalPrice}`,
    ctaUrl: isDropshipped
      ? `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`
      : undefined,
    ctaSubtext: isDropshipped ? 'AliExpress · ships worldwide' : undefined,
    evidenceScreenshot: s.screenshotUrl ?? undefined,
  }
}
