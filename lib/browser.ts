// ── Browser Provider ──────────────────────────────────────────────────────────
const USE_TINYFISH = true

import { TinyFish } from '@tiny-fish/sdk'
import type { ProfileComparison, ProfileResult, CheckoutAnalysis, VisualDarkPatterns } from './types'

// ── Rotating user agents ──────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
]

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// ── Base headers (no UA — added per-call so it can rotate) ───────────────────

const BASE_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function fetchWithHeaders(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

// ── TinyFish page fetch ───────────────────────────────────────────────────────

async function fetchPageTinyFish(
  url: string,
  onStreamUrl?: (streamUrl: string) => void,
): Promise<string> {
  const client = new TinyFish()
  const stream = await client.agent.stream({
    url,
    goal: 'Extract all visible text from this page including prices, countdown timers, stock levels, button labels, and any urgency or scarcity messages. Return JSON: { "text": "<all visible page text as one string>" }',
  })
  for await (const event of stream) {
    if (event.type === 'STREAMING_URL' && onStreamUrl) {
      onStreamUrl(event.streaming_url)
    } else if (event.type === 'COMPLETE') {
      const result = event.result as { text?: string }
      return result.text ?? ''
    }
  }
  throw new Error('TinyFish stream ended without COMPLETE event')
}

async function fetchPageTwiceTinyFish(
  url: string,
  gapMs: number,
  onLog: (msg: string) => void,
  onProgress: (value: number) => void,
  onStreamUrl?: (streamUrl: string) => void,
): Promise<{ html1: string; html2: string }> {
  onLog(`[TinyFish] Loading ${url} (visit 1)...`)
  onProgress(5)
  const html1 = await fetchPageTinyFish(url, onStreamUrl)
  onLog('Page loaded — extracting behavioral signals...')
  onProgress(20)

  onLog(`Waiting ${gapMs / 1000}s to detect timer manipulation...`)
  onProgress(25)

  const tickCount = Math.floor(gapMs / 2000)
  for (let i = 0; i < tickCount; i++) {
    await sleep(2000)
    onProgress(25 + Math.round(((i + 1) / tickCount) * 25))
  }
  const elapsed = tickCount * 2000
  if (elapsed < gapMs) await sleep(gapMs - elapsed)

  onLog('[TinyFish] Re-visiting page (visit 2)...')
  onProgress(55)
  const html2 = await fetchPageTinyFish(url)
  onProgress(60)

  return { html1, html2 }
}

// ── Core fetch (rotates UA on every call) ────────────────────────────────────

/** Always uses plain HTTP fetch — for static pages where TinyFish adds no value */
export async function fetchPagePlain(url: string): Promise<string> {
  return fetchWithHeaders(url, { ...BASE_HEADERS, 'User-Agent': randomUA() })
}

export async function fetchPage(url: string): Promise<string> {
  if (USE_TINYFISH) return fetchPageTinyFish(url)
  return fetchWithHeaders(url, { ...BASE_HEADERS, 'User-Agent': randomUA() })
}

export async function fetchPageTwice(
  url: string,
  gapMs: number,
  onLog: (msg: string) => void,
  onProgress: (value: number) => void,
  onStreamUrl?: (streamUrl: string) => void,
): Promise<{ html1: string; html2: string }> {
  if (USE_TINYFISH) return fetchPageTwiceTinyFish(url, gapMs, onLog, onProgress, onStreamUrl)

  onLog(`Connecting to ${url}...`)
  onProgress(5)
  const html1 = await fetchPage(url)
  onLog(`Page loaded — extracting behavioral signals...`)
  onProgress(20)

  onLog(`Waiting ${gapMs / 1000}s to detect timer manipulation...`)
  onProgress(25)

  const tickCount = Math.floor(gapMs / 2000)
  for (let i = 0; i < tickCount; i++) {
    await sleep(2000)
    onProgress(25 + Math.round(((i + 1) / tickCount) * 25))
  }
  const elapsed = tickCount * 2000
  if (elapsed < gapMs) await sleep(gapMs - elapsed)

  onLog(`Re-visiting page to compare snapshots...`)
  onProgress(55)
  const html2 = await fetchPage(url)
  onProgress(60)

  return { html1, html2 }
}

// ── Profile comparison ────────────────────────────────────────────────────────

const MOBILE_SG_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const PROFILE_CONFIGS: Array<{
  label: string
  baseline: boolean
  headers: Record<string, string>
}> = [
  {
    label: 'Mobile SG',
    baseline: true,
    headers: { ...BASE_HEADERS, 'User-Agent': MOBILE_SG_UA, 'Accept-Language': 'en-SG,en;q=0.9' },
  },
  {
    label: 'Desktop US',
    baseline: false,
    headers: { ...BASE_HEADERS, 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  },
  {
    label: 'No cookies',
    baseline: false,
    headers: { ...BASE_HEADERS, 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  },
  {
    label: 'Return visit',
    baseline: false,
    headers: {
      ...BASE_HEADERS,
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'visited=true; count=3',
    },
  },
]

/** Inline price extractor — keeps browser.ts free of imports from ai.ts */
function extractPricesLocal(html: string): string[] {
  const matches = html.match(/\$[\d,]+\.?\d{0,2}|USD\s*[\d,]+\.?\d{0,2}/g)
  return matches ? [...new Set(matches)].slice(0, 10) : []
}

function pricesEqual(a: string[], b: string[]): boolean {
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.length === sb.length && sa.every((v, i) => v === sb[i])
}

export async function compareProfiles(
  url: string,
  onLog: (msg: string) => void,
): Promise<ProfileComparison> {
  onLog('Starting parallel profile comparison (4 browser profiles)...')

  const settled = await Promise.allSettled(
    PROFILE_CONFIGS.map((p) => fetchWithHeaders(url, p.headers)),
  )

  const profiles: ProfileResult[] = settled.map((result, i) => ({
    label: PROFILE_CONFIGS[i].label,
    prices: result.status === 'fulfilled' ? extractPricesLocal(result.value) : [],
    baseline: PROFILE_CONFIGS[i].baseline,
  }))

  const baselinePrices = profiles.find((p) => p.baseline)?.prices ?? []
  let discriminationDetected = false

  for (const profile of profiles) {
    if (!profile.baseline && baselinePrices.length > 0 && profile.prices.length > 0) {
      if (!pricesEqual(profile.prices, baselinePrices)) {
        profile.discriminated = true
        discriminationDetected = true
      }
    }
  }

  const flagged = profiles.filter((p) => p.discriminated).map((p) => p.label)
  const summary = discriminationDetected
    ? `Price differences detected for: ${flagged.join(', ')}. Baseline (Mobile SG): ${baselinePrices.join(', ')}`
    : 'No price differences detected across browser profiles.'

  onLog(
    `Profile comparison complete — discrimination ${discriminationDetected ? 'DETECTED ⚠' : 'not detected'}`,
  )

  return { profiles, discriminationDetected, summary }
}

// ── TinyFish: Checkout hidden fee analysis ────────────────────────────────────

export async function getCheckoutAnalysis(
  url: string,
  productQuery: string,
  onLog: (msg: string) => void,
): Promise<CheckoutAnalysis> {
  onLog(productQuery
    ? `[TinyFish] Searching for "${productQuery}" and analysing checkout...`
    : '[TinyFish] Starting checkout flow analysis...'
  )
  const client = new TinyFish()
  const productStep = productQuery
    ? `First, search for "${productQuery}" on this site and open the first relevant product listing.`
    : 'Find the main featured or first available product on this page.'
  const stream = await client.agent.stream({
    url,
    goal: `${productStep} Note the listed price. Add the item to the cart, then proceed to the checkout page. Once on checkout, extract all pricing information shown. Return JSON:
{
  "productPrice": "price shown on the product page",
  "checkoutTotal": "final total shown at checkout",
  "fees": [{ "name": "fee label", "amount": "fee amount" }],
  "preCheckedItems": ["list of any pre-checked add-ons, insurance, or subscriptions found"],
  "hasAutoRenewal": false,
  "hiddenFeesDetected": false,
  "summary": "one sentence describing any price difference or hidden fees found"
}`,
  })
  for await (const event of stream) {
    if (event.type === 'COMPLETE') {
      const result = event.result as CheckoutAnalysis
      if (result.hiddenFeesDetected) {
        onLog(`⚠ Hidden fees detected — product: ${result.productPrice}, checkout total: ${result.checkoutTotal}`)
      } else {
        onLog('Checkout scan complete — no hidden fees detected')
      }
      return result
    }
  }
  throw new Error('TinyFish checkout stream ended without COMPLETE event')
}

// ── TinyFish: Visual dark pattern detection ───────────────────────────────────

export async function getVisualDarkPatterns(
  url: string,
  onLog: (msg: string) => void,
): Promise<VisualDarkPatterns> {
  onLog('[TinyFish] Taking screenshot for visual dark pattern analysis...')
  const client = new TinyFish()
  const stream = await client.agent.stream({
    url,
    goal: `Visually analyse this page for dark patterns. Look for:
1. Cookie consent manipulation (tiny or greyed-out "reject all" button, hidden decline option)
2. Pre-checked checkboxes for newsletters, insurance, or paid add-ons
3. Misleading visual hierarchy (giant "confirm" vs microscopic "cancel" or "no thanks")
4. Fake progress bars or urgency indicators designed to pressure the user
5. Confusing button colours where the site-preferred action is over-emphasised
6. Any other visual trickery that makes manipulation harder to notice

Return JSON:
{
  "visualPatterns": [
    {
      "type": "short name for the pattern",
      "description": "what you observe on the page",
      "severity": "critical" | "medium" | "low"
    }
  ],
  "screenshotObservations": "1-2 sentence overall summary of visual manipulation level"
}`,
  })
  for await (const event of stream) {
    if (event.type === 'COMPLETE') {
      const result = event.result as VisualDarkPatterns
      const count = result.visualPatterns?.length ?? 0
      onLog(`Visual scan complete — ${count} visual pattern(s) detected`)
      return result
    }
  }
  throw new Error('TinyFish visual scan stream ended without COMPLETE event')
}

// ── TinyFish: Reddit + review sentiment ──────────────────────────────────────

export async function getRedditSentiment(
  domain: string,
  onLog: (msg: string) => void,
): Promise<string> {
  onLog(`[TinyFish] Searching Reddit for "${domain}" reviews...`)
  const client = new TinyFish()
  const stream = await client.agent.stream({
    url: `https://www.reddit.com/search/?q=${encodeURIComponent(domain + ' reviews')}&sort=relevance&t=year`,
    goal: `Search this Reddit results page for posts about "${domain}". Open the top 3 most relevant posts and extract the community sentiment. Look for: complaints about scams, hidden fees, poor quality, fake products, misleading pricing, or praise for legitimacy and good service. Return JSON:
{
  "overallSentiment": "positive" | "negative" | "mixed" | "unknown",
  "topFindings": ["2-4 specific observations from real Reddit posts, quoting key phrases"],
  "scamReports": true | false,
  "hiddenFeeComplaints": true | false,
  "fakeProductComplaints": true | false,
  "postCount": <number of relevant posts found>
}`,
  })
  for await (const event of stream) {
    if (event.type === 'COMPLETE') {
      const result = event.result as Record<string, unknown>
      const sentiment = result.overallSentiment as string ?? 'unknown'
      const scam = result.scamReports ? ' ⚠ scam reports found' : ''
      onLog(`Reddit scan complete — sentiment: ${sentiment}${scam}`)
      return JSON.stringify(result)
    }
  }
  throw new Error('TinyFish Reddit stream ended without COMPLETE event')
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
