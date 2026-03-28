import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300 // Allow up to 5 minutes to prevent stream timeouts

export async function POST(req: Request) {
  const { url, query } = await req.json()
  const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY

  if (!TINYFISH_API_KEY) {
    return NextResponse.json({ error: 'TINYFISH_API_KEY is not set in environment variables.' }, { status: 500 })
  }

  // The goal string for the TinyFish autonomous agent:
  const goal = `
You are the DarkWatch Cart Cleanser & Supply Chain Agent.
Your objective is to navigate to the provided URL, search for the product "${query}", add the first relevant product to the cart, and proceed to checkout.

Crucially:
1. CART CLEANSING: At checkout, search for any hidden junk fees, pre-checked "Shipping Guarantees", or sneaky subscriptions. If found, uncheck/remove them.
2. TRUST & AUTHENTICITY: Scan the product reviews and overall site layout to evaluate a Trust Score (0-100) and flag signs of Fake Reviews.
3. SUPPLY CHAIN ANALYSIS: Examine the product image, title, and brand. Determine if this item is likely white-labeled or drop-shipped. Estimate its wholesale market value (e.g., on Alibaba/AliExpress). Calculate the retail markup percentage.

TERMINATION CONDITIONS (Stop and return the JSON immediately when ANY of these is true):
- You have successfully reached the checkout, evaluated the fees, and completed the supply chain analysis.
- You have been trying to solve a Captcha or anti-bot challenge for more than 3 steps without success.
- You are stuck in an infinite scroll, pop-up loop, or cannot find the search bar.
- You have executed more than 15 total actions.
If you terminate early due to getting stuck, do your best to estimate the Trust Score and Supply Chain Analysis based on the pages you *did* see, leave "junkFeesRemoved" empty, and return the JSON.

Extract all requested data and return exactly this JSON structure:
{
  "basePrice": "the original advertised price of the product as a string (e.g., $15.99)",
  "junkFeesRemoved": [
    {
      "name": "name of fee removed (e.g., Shipping Guarantee)",
      "amount": "dollar amount (e.g., $2.99)",
      "description": "brief description of the deceptive fee"
    }
  ],
  "finalPrice": "the true, sanitized final checkout price as a string",
  "trustScore": 45,
  "fakeReviewsDetected": true,
  "productOrigin": {
    "isDropshipped": true,
    "wholesalePriceEstimate": "$2.50",
    "markupPercentage": "540%",
    "likelySourcedFrom": "AliExpress / Alibaba",
    "analysis": "A brief, 1-2 sentence explanation of why you believe this is dropshipped and where the wholesale estimate comes from."
  }
}
`

  // Call TinyFish API
  const tinyfishRes = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
    method: "POST",
    headers: {
      "X-API-Key": TINYFISH_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: url,
      goal: goal,
      browser_profile: "stealth",
      proxy_config: {
        enabled: true,
        country_code: "US"
      }
    })
  })

  if (!tinyfishRes.ok) {
    const err = await tinyfishRes.text()
    return NextResponse.json({ error: `TinyFish API error: ${err}` }, { status: tinyfishRes.status })
  }

  // Proxy the SSE stream directly to the client
  return new Response(tinyfishRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  })
}
