import { TinyFish, BrowserProfile, ProxyCountryCode } from '@tiny-fish/sdk'
import type { SanitizationResult } from './types'

type LogLevel = 'info' | 'warn' | 'action' | 'vision' | 'success'

// Scripted fallback logs — shown until real PROGRESS events arrive from TinyFish
const SCRIPTED_LOGS: Array<{ delay: number; message: string; level: LogLevel }> = [
  { delay: 0,     message: 'Launching browser with US proxy...', level: 'action' },
  { delay: 4000,  message: 'Navigating to site...', level: 'action' },
  { delay: 9000,  message: 'Dismissing cookie banners...', level: 'action' },
  { delay: 14000, message: 'Searching for product...', level: 'action' },
  { delay: 20000, message: 'Examining product listing and reviews...', level: 'vision' },
  { delay: 26000, message: 'Checking for fake review signals...', level: 'vision' },
  { delay: 32000, message: 'Adding item to cart...', level: 'action' },
  { delay: 38000, message: 'Proceeding to checkout...', level: 'action' },
  { delay: 44000, message: 'Scanning for pre-checked add-ons and junk fees...', level: 'warn' },
  { delay: 50000, message: 'Analysing product origin and supply chain...', level: 'vision' },
  { delay: 56000, message: 'Estimating wholesale value and markup...', level: 'info' },
  { delay: 62000, message: 'Compiling findings...', level: 'info' },
]

const GOAL = (url: string, query: string) => `You are DarkWatch, an AI shopping protection agent. Protect the user from junk fees, fake reviews, and dropshipped products sold at massive markups.

SITE: ${url}
PRODUCT TO FIND: "${query}"

═══ STEP-BY-STEP INSTRUCTIONS ═══

STEP 1 — CLEAR OBSTACLES
- Navigate to the site
- If you see a cookie consent banner or popup, dismiss it immediately (click Accept, Close, or X)
- If an age verification appears, confirm it
- Do not spend more than 2 actions on any single obstacle

STEP 2 — FIND THE PRODUCT
- Use the site's search bar to search for "${query}"
- Click on the first relevant product result
- Record the exact displayed price — this is the basePrice

STEP 3 — ANALYSE THE PRODUCT PAGE (critical — do this before adding to cart)
- Study the product title and brand name. Generic names like "Portable LED Light" or unbranded items are dropship signals.
- Look at product images. Stock photos or images identical to AliExpress listings are dropship signals.
- Read the reviews section thoroughly:
  * Are reviews suspiciously similar in phrasing?
  * Do many reviews mention receiving the product for free or in exchange for a review?
  * Are there clusters of 5-star reviews on the same dates?
  * Do review profiles look like new or fake accounts?
- Based on price point, branding, and product type, estimate if this is sourced from AliExpress/Alibaba wholesale

STEP 4 — ADD TO CART AND REACH CHECKOUT
- Click "Add to Cart" or equivalent
- Navigate to the cart / checkout page
- Do NOT fill in payment details or complete the purchase
- On the checkout page:
  * List EVERY line item and fee shown
  * Check for pre-checked boxes (insurance, protection plans, rush delivery, subscriptions)
  * Note if the total is higher than the product page price
  * Look for auto-renewal or subscription language in fine print

STEP 5 — RETURN RESULTS
Complete Steps 3 and 4. Only stop early if:
- A login wall is blocking checkout and you cannot proceed past it — return what you found up to that point
- You have failed the same CAPTCHA more than 3 times in a row with no progress
- You have been completely stuck on the exact same page for more than 8 consecutive actions with no new information

Do NOT give up just because a page is slow, has a popup, or requires an extra click. Push through.

═══ RETURN EXACTLY THIS JSON ═══
{
  "basePrice": "exact price shown on the product page e.g. $19.99",
  "junkFeesRemoved": [
    {
      "name": "exact fee name as displayed e.g. Shipping Protection",
      "amount": "exact amount e.g. $3.99",
      "description": "one sentence: why this fee is deceptive e.g. Pre-checked insurance added silently without user consent"
    }
  ],
  "finalPrice": "the true price after removing all junk fees",
  "productImageUrl": "the absolute URL of the main product image shown on the product listing page (src attribute of the largest product photo), or null if not found",
  "trustScore": <integer 0-100: 90-100=trustworthy genuine reviews, 50-89=mixed signals, 0-49=fake or incentivised reviews detected>,
  "fakeReviewsDetected": <true if you saw fake/incentivised review signals, false if reviews appear genuine>,
  "productOrigin": {
    "isDropshipped": <true if likely sourced from AliExpress/Alibaba wholesale, false if appears to be a legitimate brand>,
    "wholesalePriceEstimate": "your honest estimate of the wholesale cost e.g. $2.50 or N/A if legitimate brand",
    "markupPercentage": "calculated markup e.g. 700% or N/A if legitimate brand",
    "likelySourcedFrom": "e.g. AliExpress / Alibaba or Appears to be a legitimate branded product",
    "analysis": "2-3 sentences with specific observations that support your assessment — cite the product title, images, brand, or review patterns you observed"
  },
  "screenshotUrl": null
}`

// ── Core runner ───────────────────────────────────────────────────────────────

async function runAgent(
  url: string,
  query: string,
  profile: BrowserProfile,
  onLog: (message: string, level: LogLevel) => void,
  timers: ReturnType<typeof setTimeout>[],
  onStreamUrl?: (url: string) => void,
): Promise<SanitizationResult> {
  let realProgressReceived = false
  const clearTimers = () => { for (const t of timers) clearTimeout(t) }

  const client = new TinyFish()
  const stream = await client.agent.stream({
    url,
    goal: GOAL(url, query),
    browser_profile: profile,
    proxy_config: { enabled: true, country_code: ProxyCountryCode.US },
  })

  for await (const event of stream) {
    if (event.type === 'STREAMING_URL') {
      if (onStreamUrl) {
        onStreamUrl(event.streaming_url)
        onLog('Live browser stream active — agent working...', 'info')
      }
    } else if (event.type === 'PROGRESS') {
      if (!realProgressReceived) {
        realProgressReceived = true
        clearTimers()
      }
      onLog(event.purpose, 'action')
    } else if (event.type === 'COMPLETE') {
      clearTimers()
      const result = event.result as unknown as SanitizationResult
      const savings = computeSavings(result)
      onLog(
        savings
          ? `Agent done — ${result.junkFeesRemoved?.length ?? 0} fee(s) found, saved ${savings}`
          : `Agent done — true price: ${result.finalPrice}`,
        'success',
      )
      return result
    }
  }

  clearTimers()
  throw new Error('TinyFish stream ended without COMPLETE event')
}

function hasUsefulData(r: SanitizationResult): boolean {
  return !!(r?.basePrice || r?.finalPrice || (r?.junkFeesRemoved?.length ?? 0) > 0)
}

// ── Public entry ──────────────────────────────────────────────────────────────

export async function cleanCart(
  url: string,
  query: string,
  onLog: (message: string, level: LogLevel) => void,
  onStreamUrl: (url: string) => void,
): Promise<SanitizationResult> {
  // Start scripted fallback logs — cancelled as soon as real PROGRESS events arrive
  const logTimers: ReturnType<typeof setTimeout>[] = []
  for (const entry of SCRIPTED_LOGS) {
    logTimers.push(
      setTimeout(() => onLog(entry.message, entry.level), entry.delay),
    )
  }
  const clearTimers = () => { for (const t of logTimers) clearTimeout(t) }

  // ── Attempt 1: LITE — live browser stream, runs until it genuinely errors ────
  // No hard timeout — let TinyFish take as long as needed to complete the full
  // shopping flow. The route's maxDuration = 300 is the real ceiling.
  try {
    const result = await runAgent(url, query, BrowserProfile.LITE, onLog, logTimers, onStreamUrl)
    if (hasUsefulData(result)) return result
    throw new Error('LITE returned no usable data')
  } catch (err) {
    clearTimers()
    const reason = err instanceof Error ? err.message : 'unknown error'
    onLog(`Lite browser hit an error (${reason}) — switching to stealth...`, 'warn')
  }

  // ── Attempt 2: STEALTH — only reached if LITE actually threw, not just slow ──
  onLog('Stealth browser launching — agent will complete the scan...', 'action')
  try {
    return await runAgent(url, query, BrowserProfile.STEALTH, onLog, [], undefined)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown'
    onLog(`Stealth agent could not complete (${reason}) — returning partial data`, 'warn')
    return { basePrice: 'unknown', junkFeesRemoved: [], finalPrice: 'unknown' }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeSavings(result: SanitizationResult): string | null {
  try {
    const fees = (result.junkFeesRemoved ?? []).reduce(
      (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, '') || '0'),
      0,
    )
    if (fees > 0) return `$${fees.toFixed(2)}`
  } catch {}
  return null
}
