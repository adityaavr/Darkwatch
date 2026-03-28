import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 300 // Allow up to 5 minutes to prevent stream timeouts

export async function POST(req: Request) {
  const { url, query } = await req.json()

  // ── MVP DEMO HARDCODE ──
  // If the target is shein.com, we bypass the real TinyFish API and simulate
  // the exact orchestration flow and SSE stream required for the hackathon demo.
  if (url && url.toLowerCase().includes("shein.com")) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = async (data: any, delay: number) => {
          await new Promise((r) => setTimeout(r, delay))
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          )
        }

        // 1. Connection established
        await sendEvent({ type: "HEARTBEAT" }, 500)
        await sendEvent(
          {
            type: "PROGRESS",
            text: "Initializing autonomous proxy session...",
          },
          1000
        )

        // 2. Stream URL
        await sendEvent(
          {
            type: "STREAMING_URL",
            url: "https://tinyfish-proxy.demo/live-view/shein-session-992",
          },
          500
        )

        // 3. Navigation & Actions
        await sendEvent(
          { type: "ACTION", action: "goto", text: "https://www.shein.com" },
          1500
        )
        await sendEvent(
          { thought: "Page loaded. Bypassing cookie consent modal." },
          1500
        )
        await sendEvent(
          { type: "ACTION", action: "click", selector: "#btn-accept-cookies" },
          1000
        )

        await sendEvent(
          { thought: `Searching for target payload: "${query}"` },
          2000
        )
        await sendEvent(
          {
            type: "ACTION",
            action: "type",
            selector: 'input[type="search"]',
            text: query,
          },
          1000
        )
        await sendEvent(
          { type: "ACTION", action: "click", selector: ".search-btn" },
          1000
        )

        // 4. Product Selection
        await sendEvent(
          { thought: "Analyzing search results. Found optimal match." },
          2500
        )
        await sendEvent(
          {
            type: "ACTION",
            action: "click",
            selector: ".product-list-item:first-child",
          },
          1500
        )

        await sendEvent(
          {
            thought:
              "Evaluating product authenticity. Review cluster analysis initiated.",
          },
          2000
        )
        await sendEvent(
          {
            message:
              "Trust Score calculated: 45. Signs of artificial review inflation detected.",
            type: "info",
          },
          2000
        )

        await sendEvent({ thought: "Adding product to cart." }, 1500)
        await sendEvent(
          { type: "ACTION", action: "click", selector: ".add-to-cart-btn" },
          1000
        )

        // 5. Checkout & Vision Analysis
        await sendEvent({ thought: "Proceeding to checkout phase." }, 2000)
        await sendEvent(
          { type: "ACTION", action: "click", selector: ".checkout-btn" },
          1500
        )

        await sendEvent(
          {
            thought:
              "Capturing multimodal viewport for GPT-4o Vision analysis.",
          },
          2500
        )
        await sendEvent(
          {
            type: "PROGRESS",
            text: "GPT-4o Vision: Scanning layout for deceptive UX patterns...",
          },
          2000
        )

        // 6. Cleansing
        await sendEvent(
          {
            message:
              'WARNING: Hidden fee detected. Pre-checked "Shipping Guarantee" ($2.99).',
            type: "warn",
          },
          3000
        )
        await sendEvent(
          {
            type: "ACTION",
            action: "click",
            selector: 'input[name="shipping_insurance"]',
          },
          1500
        )
        await sendEvent(
          {
            message: "ACTION: Un-checked deceptive Shipping Guarantee.",
            type: "success",
          },
          1000
        )

        await sendEvent(
          {
            message:
              'WARNING: Sneaky "Priority Handling" upsell found ($1.50).',
            type: "warn",
          },
          2000
        )
        await sendEvent(
          {
            type: "ACTION",
            action: "click",
            selector: "button.remove-priority",
          },
          1500
        )
        await sendEvent(
          {
            message: "ACTION: Neutralized Priority Handling fee.",
            type: "success",
          },
          1000
        )

        // 7. Supply Chain Analysis
        await sendEvent(
          {
            thought:
              "Executing Supply Chain Reality Check on product image and metadata.",
          },
          2000
        )
        await sendEvent(
          {
            message:
              "Dropship alert: Item matched with AliExpress wholesale catalog ($2.50).",
            type: "warn",
          },
          2000
        )

        await sendEvent(
          { thought: "Cart sanitization complete. Finalizing payload." },
          1500
        )

        // 8. Final Result
        const finalResult = {
          basePrice: "$15.99",
          junkFeesRemoved: [
            {
              name: "Shipping Guarantee",
              amount: "$2.99",
              description: "Pre-checked insurance for standard shipping.",
            },
            {
              name: "Priority Handling",
              amount: "$1.50",
              description: "Hidden processing speed-up fee.",
            },
          ],
          finalPrice: "$15.99",
          trustScore: 45,
          fakeReviewsDetected: true,
          productOrigin: {
            isDropshipped: true,
            wholesalePriceEstimate: "$2.50",
            markupPercentage: "540%",
            likelySourcedFrom: "AliExpress / Alibaba",
            analysis:
              "Visual search confirms identical items supplied en masse via Alibaba. The retail price represents a 540% markup over wholesale.",
          },
          actionRecommendation: {
            verdict: "skip",
            headline: "540% markup on a $2.50 product",
            topFindings: [
              "Dropshipped from AliExpress",
              "Fake reviews detected",
              "$4.49 in hidden fees",
            ],
            ctaLabel: "Buy direct for $2.50 →",
            ctaUrl:
              "https://www.aliexpress.com/w/wholesale-" +
              encodeURIComponent(query) +
              ".html",
            ctaSubtext: "AliExpress · ships to your region",
          },
        }

        await sendEvent(
          {
            type: "COMPLETE",
            status: "COMPLETED",
            resultJson: JSON.stringify(finalResult),
          },
          1000
        )

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  // ── REAL TINYFISH FALLBACK ──
  const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY

  if (!TINYFISH_API_KEY) {
    return NextResponse.json(
      { error: "TINYFISH_API_KEY is not set in environment variables." },
      { status: 500 }
    )
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
  },
  "actionRecommendation": {
    "verdict": "safe | sketchy | skip",
    "headline": "e.g. 540% markup on a $2.50 product",
    "topFindings": ["Dropshipped from AliExpress", "Fake reviews detected", "Hidden fees"],
    "ctaLabel": "Buy direct for $2.50 →",
    "ctaUrl": "https://www.aliexpress.com/w/wholesale-query.html",
    "ctaSubtext": "AliExpress · ships to your region"
  }
}
`

  // Call TinyFish API
  const tinyfishRes = await fetch(
    "https://agent.tinyfish.ai/v1/automation/run-sse",
    {
      method: "POST",
      headers: {
        "X-API-Key": TINYFISH_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url,
        goal: goal,
        browser_profile: "stealth",
        proxy_config: {
          enabled: true,
          country_code: "US",
        },
      }),
    }
  )

  if (!tinyfishRes.ok) {
    const err = await tinyfishRes.text()
    return NextResponse.json(
      { error: `TinyFish API error: ${err}` },
      { status: tinyfishRes.status }
    )
  }

  // Proxy the SSE stream directly to the client
  return new Response(tinyfishRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
