import { TinyFish } from '@tiny-fish/sdk'
import type { CartResult } from './types'

const SCRIPTED_LOGS: Array<{ delay: number; message: string; level: 'info' | 'action' | 'vision' | 'warn' | 'success' }> = [
  { delay: 0,    message: 'Navigating to shein.com...', level: 'action' },
  { delay: 3000, message: 'Page loaded. Scanning product listings...', level: 'info' },
  { delay: 6000, message: 'Searching for product in catalog...', level: 'action' },
  { delay: 10000, message: 'Product found. Analysing listing for pre-checked add-ons...', level: 'vision' },
  { delay: 14000, message: 'Adding item to cart...', level: 'action' },
  { delay: 18000, message: 'Proceeding to checkout...', level: 'action' },
  { delay: 22000, message: 'Extracting fee breakdown from checkout...', level: 'vision' },
  { delay: 26000, message: 'Scanning for pre-checked insurance and subscriptions...', level: 'warn' },
  { delay: 30000, message: 'Stripping junk line items...', level: 'action' },
  { delay: 34000, message: 'Recalculating true price...', level: 'info' },
]

export async function cleanCart(
  query: string,
  onLog: (message: string, level: 'info' | 'warn' | 'action' | 'vision' | 'success') => void,
  onStreamUrl: (url: string) => void,
): Promise<CartResult> {
  // Fire scripted logs in parallel with TinyFish execution
  const logTimers: ReturnType<typeof setTimeout>[] = []
  for (const entry of SCRIPTED_LOGS) {
    logTimers.push(setTimeout(() => onLog(entry.message, entry.level), entry.delay))
  }

  try {
    const client = new TinyFish()
    const stream = await client.agent.stream({
      url: 'https://www.shein.com',
      goal: `Search for "${query}" on this page. Find the first relevant product and click on it to open the product page. Note the listed price. Add the item to the cart. Proceed to the checkout page. Once on the checkout page:
1. Extract the product name and the price shown on the product page.
2. Extract the final checkout total including all fees shown.
3. List every fee line item shown (name and amount).
4. List any pre-checked items such as insurance, shipping protection, subscriptions, or any add-ons that were automatically added.
5. Identify whether any auto-renewal subscription is present.
6. Calculate what the total would be without any optional fees or pre-checked add-ons.
7. Calculate the savings.

Return as JSON exactly:
{
  "productName": "the product name as listed",
  "basePrice": "the listed product price e.g. $12.99",
  "originalCartTotal": "the full checkout total including all fees e.g. $19.98",
  "sanitizedTotal": "the total with all optional/junk fees removed e.g. $13.99",
  "feesStripped": [
    { "name": "fee name", "amount": "$X.XX", "stripped": true }
  ],
  "savings": "amount saved e.g. $5.99",
  "success": true
}`,
    })

    for await (const event of stream) {
      if (event.type === 'STREAMING_URL') {
        onStreamUrl(event.streaming_url)
        onLog('Live browser view ready — agent is working...', 'info')
      } else if (event.type === 'PROGRESS') {
        // Cancel scripted logs once we get real progress events
        for (const t of logTimers) clearTimeout(t)
        onLog(event.purpose, 'action')
      } else if (event.type === 'COMPLETE') {
        for (const t of logTimers) clearTimeout(t)
        const result = event.result as CartResult
        onLog(`Cart cleaned — saved ${result.savings}`, 'success')
        return result
      }
    }

    throw new Error('TinyFish stream ended without COMPLETE event')
  } catch (err) {
    for (const t of logTimers) clearTimeout(t)
    throw err
  }
}
