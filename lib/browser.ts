// ── Browser Provider ──────────────────────────────────────────────────────────
// SWAP: set USE_TINYFISH = true on hackathon day (needs TINYFISH_API_KEY in .env.local)
const USE_TINYFISH = false

import type { ProfileComparison, ProfileResult } from './types'

// ── Rotating user agents (Task 3) ─────────────────────────────────────────────

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

// ── Core fetch (rotates UA on every call) ────────────────────────────────────

export async function fetchPage(url: string): Promise<string> {
  if (USE_TINYFISH) return fetchPageTinyFish(url)
  return fetchWithHeaders(url, { ...BASE_HEADERS, 'User-Agent': randomUA() })
}

export async function fetchPageTwice(
  url: string,
  gapMs: number,
  onLog: (msg: string) => void,
  onProgress: (value: number) => void,
): Promise<{ html1: string; html2: string }> {
  if (USE_TINYFISH) return fetchPageTwiceTinyFish(url, gapMs, onLog, onProgress)

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
    onProgress(25 + Math.round(((i + 1) / tickCount) * 25)) // 25 → 50
  }
  const elapsed = tickCount * 2000
  if (elapsed < gapMs) await sleep(gapMs - elapsed)

  onLog(`Re-visiting page to compare snapshots...`)
  onProgress(55)
  const html2 = await fetchPage(url)
  onProgress(60)

  return { html1, html2 }
}

// ── Profile comparison (Task 1) ───────────────────────────────────────────────

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

// ── TinyFish stub (activate on hackathon day) ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchPageTinyFish(_url: string): Promise<string> {
  // TODO (hackathon day): replace with TinyFish browser session
  // const session = await TinyFish.createSession({ apiKey: process.env.TINYFISH_API_KEY })
  // await session.navigate(_url)
  // await session.waitForLoad()
  // const html = await session.getContent()
  // await session.close()
  // return html
  throw new Error('TinyFish not configured — set USE_TINYFISH = false or add TINYFISH_API_KEY')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchPageTwiceTinyFish(
  _url: string,
  _gapMs: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _onLog: (msg: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _onProgress: (value: number) => void,
): Promise<{ html1: string; html2: string }> {
  // TODO (hackathon day): full TinyFish session flow
  throw new Error('TinyFish not configured')
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
