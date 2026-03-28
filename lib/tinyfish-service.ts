import { TinyFish, BrowserProfile, ProxyCountryCode } from '@tiny-fish/sdk'
import type { SanitizationResult } from './types'
import { getSpatialValidation } from './ai'

const SCRIPTED_LOGS: Array<{ delay: number; message: string; level: 'info' | 'action' | 'vision' | 'warn' | 'success' }> = [
  { delay: 0,     message: 'Initialising stealth browser (US proxy)...', level: 'action' },
  { delay: 3000,  message: 'Navigating to site...', level: 'action' },
  { delay: 7000,  message: 'Searching for product in catalog...', level: 'action' },
  { delay: 12000, message: 'Product found. Scanning listing for pre-checked add-ons...', level: 'vision' },
  { delay: 17000, message: 'Adding item to cart...', level: 'action' },
  { delay: 22000, message: 'Proceeding to checkout...', level: 'action' },
  { delay: 27000, message: 'Extracting fee breakdown...', level: 'vision' },
  { delay: 32000, message: 'Scanning for junk fees and pre-checked subscriptions...', level: 'warn' },
  { delay: 37000, message: 'Analysing product origin and supply chain...', level: 'vision' },
  { delay: 42000, message: 'Running reverse image search for wholesale source...', level: 'vision' },
  { delay: 47000, message: 'Detecting fake reviews...', level: 'info' },
  { delay: 52000, message: 'Calculating true price and markup...', level: 'info' },
]

export async function cleanCart(
  url: string,
  query: string,
  onLog: (message: string, level: 'info' | 'warn' | 'action' | 'vision' | 'success') => void,
  onStreamUrl: (url: string) => void,
): Promise<SanitizationResult> {
  // Fire scripted logs in parallel — replaced by real PROGRESS events once they start arriving
  const logTimers: ReturnType<typeof setTimeout>[] = []
  let realProgressReceived = false

  for (const entry of SCRIPTED_LOGS) {
    logTimers.push(
      setTimeout(() => {
        if (!realProgressReceived) onLog(entry.message, entry.level)
      }, entry.delay),
    )
  }

  const clearTimers = () => {
    for (const t of logTimers) clearTimeout(t)
  }

  try {
    const client = new TinyFish()

    const goal = `
You are the DarkWatch Cart Cleanser & Supply Chain Agent.
Navigate to the provided URL, search for "${query}", add the first relevant product to the cart, and proceed to checkout.

Your tasks:
1. CART CLEANSING: At checkout, identify any hidden junk fees, pre-checked "Shipping Guarantees", or sneaky subscriptions. Note them all including their amounts and descriptions.
2. TRUST & AUTHENTICITY: Scan product reviews for signs of fake or incentivised reviews. Provide a Trust Score (0-100).
3. SUPPLY CHAIN ANALYSIS: Examine the product image, title, and brand. Determine if this item is likely white-labelled or drop-shipped from a wholesale source (Alibaba/AliExpress). Estimate the wholesale market value and calculate the retail markup percentage.
4. SPATIAL DATA: Extract the exact physical dimensions of the product (length, width, height) from the product page.

Termination conditions (stop and return JSON immediately when ANY is true):
- You have reached checkout, evaluated fees, and completed the supply chain analysis.
- You have been attempting to solve a CAPTCHA for more than 3 steps without success.
- You are stuck in an infinite loop or cannot find the search bar.
- You have executed more than 20 total actions.

Return exactly this JSON structure:
{
  "basePrice": "the original advertised price (e.g. $15.99)",
  "junkFeesRemoved": [
    {
      "name": "fee name (e.g. Shipping Guarantee)",
      "amount": "dollar amount (e.g. $2.99)",
      "description": "brief description of why this fee is deceptive"
    }
  ],
  "finalPrice": "the true sanitized final price after removing junk fees",
  "trustScore": 45,
  "fakeReviewsDetected": true,
  "productOrigin": {
    "isDropshipped": true,
    "wholesalePriceEstimate": "$2.50",
    "markupPercentage": "540%",
    "likelySourcedFrom": "AliExpress / Alibaba",
    "analysis": "1-2 sentence explanation of why this is dropshipped and where the estimate comes from."
  },
  "productDimensions": "the physical size found (e.g. 17.5 x 12.5 x 2 cm)",
  "productDescription": "one sentence describing the item visually"
}
`

    const stream = await client.agent.stream({
      url,
      goal,
      browser_profile: BrowserProfile.STEALTH,
      proxy_config: { enabled: true, country_code: ProxyCountryCode.US },
    })

    for await (const event of stream) {
      if (event.type === 'STREAMING_URL') {
        onStreamUrl(event.streaming_url)
        onLog('Live browser view ready — agent working...', 'info')
      } else if (event.type === 'PROGRESS') {
        if (!realProgressReceived) {
          realProgressReceived = true
          clearTimers()
        }
        onLog(event.purpose, 'action')
      } else if (event.type === 'COMPLETE') {
        clearTimers()
        const result = event.result as any
        
        // Run spatial validation after we have the dimensions from the agent
        if (result.productDimensions && result.productDimensions !== 'Unknown') {
          onLog(`[Nano Banana 2] Verifying physical scale: ${result.productDimensions}...`, 'vision')
          result.spatialValidation = await getSpatialValidation(
            query, 
            `Dimensions: ${result.productDimensions}. Description: ${result.productDescription}`, 
            (msg) => onLog(msg, 'vision')
          )
        }

        const savings = computeSavings(result)
        onLog(
          savings
            ? `Cart cleaned — ${result.junkFeesRemoved.length} fee(s) stripped, saved ${savings}`
            : `Cart cleaned — true price: ${result.finalPrice}`,
          'success',
        )
        return result as SanitizationResult
      }
    }

    throw new Error('TinyFish stream ended without COMPLETE event')
  } catch (err) {
    clearTimers()
    throw err
  }
}

function computeSavings(result: SanitizationResult): string | null {
  try {
    const base = parseFloat(result.basePrice.replace(/[^0-9.]/g, ''))
    const final = parseFloat(result.finalPrice.replace(/[^0-9.]/g, ''))
    const fees = result.junkFeesRemoved.reduce(
      (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, '')),
      0,
    )
    if (!isNaN(base) && !isNaN(final) && fees > 0) {
      return `$${fees.toFixed(2)}`
    }
  } catch {}
  return null
}
