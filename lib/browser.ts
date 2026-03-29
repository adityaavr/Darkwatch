/**
 * browser.ts
 *
 * Static/plain-HTTP browser utilities. All interactive browser sessions
 * (cart scan, visual evidence, Reddit) are now in playwright-service.ts.
 *
 * Exports:
 *   fetchPagePlain        — plain HTTP fetch with rotating UA
 *   fetchPageTwice        — two plain HTTP fetches with a gap (timer detection)
 *   compareProfiles       — parallel plain-HTTP profile comparison
 *   getCheckoutAnalysis   — re-exported from playwright-service (Playwright)
 *   getVisualDarkPatterns — re-exported from playwright-service (Playwright)
 *   getRedditSentiment    — re-exported from playwright-service (Playwright)
 */

import type { ProfileComparison, ProfileResult, CheckoutAnalysis } from './types'

// Re-export Playwright-powered functions so callers don't need to change imports
export { getVisualDarkPatterns, getRedditSentiment } from './playwright-service'

// ── Rotating user agents ───────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
]

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

const BASE_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

async function fetchWithHeaders(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

// ── Plain HTTP fetchers (no browser, fast) ─────────────────────────────────────

/** Always uses plain HTTP — for static pages (Trustpilot, policy pages, etc.) */
export async function fetchPagePlain(url: string): Promise<string> {
  return fetchWithHeaders(url, { ...BASE_HEADERS, 'User-Agent': randomUA() })
}

export async function fetchPage(url: string): Promise<string> {
  return fetchWithHeaders(url, { ...BASE_HEADERS, 'User-Agent': randomUA() })
}

export async function fetchPageTwice(
  url: string,
  gapMs: number,
  onLog: (msg: string) => void,
  onProgress: (value: number) => void,
): Promise<{ html1: string; html2: string }> {
  onLog(`Connecting to ${url}...`)
  onProgress(5)
  const html1 = await fetchPage(url)
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

  onLog('Re-visiting page to compare snapshots...')
  onProgress(55)
  const html2 = await fetchPage(url)
  onProgress(60)

  return { html1, html2 }
}

// ── Profile comparison (plain HTTP, 4 browser profiles) ───────────────────────

const MOBILE_SG_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const PROFILE_CONFIGS: Array<{
  label: string
  baseline: boolean
  headers: Record<string, string>
}> = [
  { label: 'Mobile SG', baseline: true,  headers: { ...BASE_HEADERS, 'User-Agent': MOBILE_SG_UA, 'Accept-Language': 'en-SG,en;q=0.9' } },
  { label: 'Desktop US', baseline: false, headers: { ...BASE_HEADERS, 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
  { label: 'No cookies', baseline: false, headers: { ...BASE_HEADERS, 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
  { label: 'Return visit', baseline: false, headers: { ...BASE_HEADERS, 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'visited=true; count=3' } },
]

function extractPricesLocal(html: string): string[] {
  const matches = html.match(/\$[\d,]+\.?\d{0,2}|USD\s*[\d,]+\.?\d{0,2}/g)
  return matches ? [...new Set(matches)].slice(0, 10) : []
}

function pricesEqual(a: string[], b: string[]): boolean {
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.length === sb.length && sa.every((v, i) => v === sb[i])
}

export async function compareProfiles(url: string, onLog: (msg: string) => void): Promise<ProfileComparison> {
  onLog('Starting parallel profile comparison (4 browser profiles)...')
  const settled = await Promise.allSettled(PROFILE_CONFIGS.map(p => fetchWithHeaders(url, p.headers)))
  const profiles: ProfileResult[] = settled.map((result, i) => ({
    label: PROFILE_CONFIGS[i].label,
    prices: result.status === 'fulfilled' ? extractPricesLocal(result.value) : [],
    baseline: PROFILE_CONFIGS[i].baseline,
  }))

  const baselinePrices = profiles.find(p => p.baseline)?.prices ?? []
  let discriminationDetected = false

  for (const profile of profiles) {
    if (!profile.baseline && baselinePrices.length > 0 && profile.prices.length > 0) {
      if (!pricesEqual(profile.prices, baselinePrices)) {
        profile.discriminated = true
        discriminationDetected = true
      }
    }
  }

  const flagged = profiles.filter(p => p.discriminated).map(p => p.label)
  const summary = discriminationDetected
    ? `Price differences detected for: ${flagged.join(', ')}. Baseline (Mobile SG): ${baselinePrices.join(', ')}`
    : 'No price differences detected across browser profiles.'

  onLog(`Profile comparison complete — discrimination ${discriminationDetected ? 'DETECTED ⚠' : 'not detected'}`)
  return { profiles, discriminationDetected, summary }
}

// ── Checkout analysis (Playwright stub) ───────────────────────────────────────
// Cart data now comes from runPlaywrightScan — this stub satisfies any callers.

export async function getCheckoutAnalysis(
  _url: string,
  _productQuery: string,
  onLog: (msg: string) => void,
): Promise<CheckoutAnalysis> {
  onLog('Checkout analysis handled by Playwright cart scan')
  return {
    productPrice: 'N/A',
    checkoutTotal: 'N/A',
    fees: [],
    preCheckedItems: [],
    hasAutoRenewal: false,
    hiddenFeesDetected: false,
    summary: 'Checkout analysis integrated into cart scan.',
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
