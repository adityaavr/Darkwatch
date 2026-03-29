/**
 * tinyfish-service.ts  (now Playwright-powered — TinyFish removed)
 *
 * Responsibilities:
 *   1. buildSitePlan      — GPT-4o generates site-specific plan (cart button, known fees, search URL)
 *   2. runPlaywrightScan  — Playwright browser: navigate → screenshot → add to cart → detect fees
 *   3. cleanCart          — Public entry point: orchestrates all tasks and returns SanitizationResult
 */

import OpenAI from "openai"
import { analyzeProductPage } from "./product-analysis"
import { resolvePriceWithAiWebFallback } from "./price-fallback"
import { runPlaywrightScan } from "./playwright-service"
import type { SanitizationResult, JunkFee } from "./types"

type LogLevel = "info" | "warn" | "action" | "vision" | "success"

// ── Scripted fallback logs ─────────────────────────────────────────────────────
// Shown while the real browser is warming up, so the UI never looks frozen.

const SCRIPTED_LOGS: Array<{
  delay: number
  message: string
  level: LogLevel
}> = [
  {
    delay: 0,
    message: "GPT-4o analysing site structure and known patterns...",
    level: "vision",
  },
  { delay: 6000, message: "Browser opening product page...", level: "action" },
  {
    delay: 16000,
    message: "Scanning for pre-checked fees and hidden add-ons...",
    level: "vision",
  },
  { delay: 28000, message: "Adding item to cart...", level: "action" },
  { delay: 42000, message: "Inspecting cart for junk fees...", level: "warn" },
  {
    delay: 58000,
    message: "Capturing visual evidence of dark patterns...",
    level: "vision",
  },
  { delay: 75000, message: "Compiling findings...", level: "info" },
]

// ── Site plan ──────────────────────────────────────────────────────────────────

type SitePlan = {
  productUrl: string // best URL to start on — search results or the original
  isHomepage: boolean // true when user gave us a domain root
  cartButtonLabel: string // exact "Add to Cart" button text on this site
  knownFees: string[] // fee patterns GPT-4o knows about
  requiresLoginForCart: boolean
}

function isHomepageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.pathname === "/" || u.pathname === ""
  } catch {
    return true
  }
}

// Hardcoded search URL templates — used when GPT-4o fails so the browser
// never starts lost on a homepage.
const KNOWN_SEARCH_URLS: Record<string, (q: string) => string> = {
  "shein.com": (q) =>
    `https://www.shein.com/catalog/search.html?q=${encodeURIComponent(q)}`,
  "temu.com": (q) =>
    `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(q)}`,
  "amazon.com": (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  "amazon.co.uk": (q) =>
    `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}`,
  "ebay.com": (q) =>
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  "aliexpress.com": (q) =>
    `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`,
  "etsy.com": (q) => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
  "walmart.com": (q) =>
    `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  "target.com": (q) =>
    `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,
  "asos.com": (q) => `https://www.asos.com/search/?q=${encodeURIComponent(q)}`,
  "zara.com": (q) =>
    `https://www.zara.com/us/en/search?searchTerm=${encodeURIComponent(q)}`,
  "hm.com": (q) =>
    `https://www2.hm.com/en_us/search-results.html?q=${encodeURIComponent(q)}`,
  "bestbuy.com": (q) =>
    `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,
  "wayfair.com": (q) =>
    `https://www.wayfair.com/keyword.php?keyword=${encodeURIComponent(q)}`,
  "booking.com": (q) =>
    `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`,
  "nike.com": (q) =>
    `https://www.nike.com/w?q=${encodeURIComponent(q)}&vst=${encodeURIComponent(q)}`,
  "adidas.com": (q) =>
    `https://www.adidas.com/us/search?q=${encodeURIComponent(q)}`,
  "wish.com": (q) => `https://www.wish.com/search/${encodeURIComponent(q)}`,
}

function getKnownSearchUrl(domain: string, query: string): string | null {
  const clean = domain.replace(/^www\./, "")
  const fn = KNOWN_SEARCH_URLS[clean]
  return fn ? fn(query) : null
}

async function buildSitePlan(
  url: string,
  domain: string,
  query: string,
  onLog: (msg: string, level: LogLevel) => void
): Promise<SitePlan> {
  const homepage = isHomepageUrl(url)

  try {
    onLog(`GPT-4o building plan for ${domain}...`, "vision")
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `You are an e-commerce expert with detailed knowledge of ${domain}.

The user wants to scan for hidden fees when buying: "${query}"
Starting URL: ${url}
Is this a homepage: ${homepage}

Answer:
1. Exact text on the Add to Cart button on ${domain}?
2. Does ${domain} require login BEFORE the cart drawer appears? (true/false)
3. What hidden fees or pre-checked add-ons does ${domain} commonly add?
4. ${homepage ? `Best search URL on ${domain} for "${query}"? (full https:// URL)` : `The URL is already a product page — return it as-is: ${url}`}

Return ONLY valid JSON:
{
  "cartButtonLabel": "exact button text",
  "requiresLoginForCart": false,
  "knownFees": ["fee name: how it appears"],
  "productSearchUrl": "full URL"
}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
    })

    const parsed = JSON.parse(res.choices[0].message.content!) as {
      cartButtonLabel?: string
      requiresLoginForCart?: boolean
      knownFees?: string[]
      productSearchUrl?: string
    }

    const fees = parsed.knownFees ?? []
    const productUrl = parsed.productSearchUrl?.startsWith("http")
      ? parsed.productSearchUrl
      : homepage
        ? (getKnownSearchUrl(domain, query) ?? url)
        : url

    if (homepage && productUrl !== url) {
      onLog(
        `Starting on search page: ${new URL(productUrl).pathname}`,
        "vision"
      )
    }
    if (fees.length > 0) {
      onLog(
        `Known patterns on ${domain}: ${fees.slice(0, 2).join(" · ")}`,
        "vision"
      )
    }
    if (parsed.requiresLoginForCart) {
      onLog(`${domain} requires login before cart — skipping cart scan`, "info")
    }

    return {
      productUrl,
      isHomepage: homepage,
      cartButtonLabel: parsed.cartButtonLabel ?? "Add to Cart",
      knownFees: fees,
      requiresLoginForCart: parsed.requiresLoginForCart ?? false,
    }
  } catch {
    const fallbackUrl = homepage
      ? (getKnownSearchUrl(domain, query) ?? url)
      : url
    onLog(
      fallbackUrl !== url
        ? `Site plan unavailable — using known search URL for ${domain}`
        : "Site plan unavailable — using original URL",
      "info"
    )
    return {
      productUrl: fallbackUrl,
      isHomepage: homepage,
      cartButtonLabel: "Add to Cart",
      knownFees: [],
      requiresLoginForCart: false,
    }
  }
}

// ── GPT-4o retailer intelligence fallback ─────────────────────────────────────
// Only runs when Playwright found nothing — uses training-data knowledge.

async function getRetailerIntelligence(
  domain: string,
  query: string,
  knownFees: string[],
  onLog: (msg: string, level: LogLevel) => void
): Promise<JunkFee[]> {
  if (knownFees.length > 0) {
    onLog(
      `Using retailer intelligence: ${knownFees.length} known fee pattern(s) for ${domain}`,
      "warn"
    )
    return knownFees.map((f) => ({
      name: f.split(":")[0]?.trim() ?? f,
      amount: f.match(/\$[\d.]+/)?.[0] ?? "varies",
      description: f,
    }))
  }
  try {
    onLog(`Querying fee database for ${domain}...`, "vision")
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `What hidden fees or junk charges does ${domain} add to orders for "${query}"? Only list ones you are CONFIDENT exist.
Return ONLY valid JSON — empty array if nothing certain:
{ "knownFees": [{ "name": "...", "amount": "typical amount", "description": "how it is hidden or auto-added" }] }`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 250,
    })
    const parsed = JSON.parse(res.choices[0].message.content!) as {
      knownFees?: JunkFee[]
    }
    const fees = parsed.knownFees ?? []
    if (fees.length > 0)
      onLog(
        `${fees.length} known fee pattern(s) confirmed for ${domain}`,
        "warn"
      )
    return fees
  } catch {
    return []
  }
}

// ── Merge fee lists, deduplicating by name ─────────────────────────────────────

function mergeFeeLists(fees: JunkFee[]): JunkFee[] {
  const seen = new Set<string>()
  return fees.filter((f) => {
    const key = f.name.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Public entry point ─────────────────────────────────────────────────────────
//
// Flow:
//   1. GPT-4o builds site plan (fast, ~3s)
//   2. Playwright browser + GPT-4o page analysis run in parallel
//   3. If nothing found, GPT-4o retailer intelligence fills the gap
//

export async function cleanCart(
  url: string,
  query: string,
  onLog: (msg: string, level: LogLevel) => void,
  _onStreamUrl: (url: string) => void, // kept for API compatibility
  onScreenshot?: (dataUrl: string) => void
): Promise<SanitizationResult> {
  // Start scripted logs — they stop automatically once real logs start
  const logTimers: ReturnType<typeof setTimeout>[] = []
  let realProgressReceived = false

  for (const entry of SCRIPTED_LOGS) {
    logTimers.push(
      setTimeout(() => {
        if (!realProgressReceived) onLog(entry.message, entry.level)
      }, entry.delay)
    )
  }

  const clearTimers = () => {
    realProgressReceived = true
    for (const t of logTimers) clearTimeout(t)
  }

  const wrappedLog = (msg: string, level: LogLevel) => {
    clearTimers()
    onLog(msg, level)
  }

  const domain = new URL(url).hostname.replace("www.", "")

  try {
    // ── Step 1: Site plan (GPT-4o, ~3s) ──────────────────────────────────────
    const sitePlan = await buildSitePlan(url, domain, query, wrappedLog)

    // ── Step 2: Playwright scan + page analysis in parallel ───────────────────
    const [pageAnalysis, playwrightResult] = await Promise.all([
      analyzeProductPage(sitePlan.productUrl, query, (msg) =>
        wrappedLog(msg, "info")
      ),
      runPlaywrightScan(sitePlan, query, wrappedLog, onScreenshot),
    ])

    // ── Step 3: keep output strictly evidence-based ───────────────────────────
    const browserFoundFees = playwrightResult.cartFees.length > 0
    const retailerFees: JunkFee[] = []
    if (!browserFoundFees && !playwrightResult.cartDrawerReached) {
      wrappedLog(
        `Could not verify cart details on ${domain} (likely bot protection). Skipping synthetic fee guesses.`,
        "warn"
      )
    }

    clearTimers()

    // ── Merge all fee sources ─────────────────────────────────────────────────
    const allFees = mergeFeeLists([
      ...playwrightResult.cartFees,
      ...retailerFees,
    ])

    // Product image: Playwright DOM extraction → og:image/JSON-LD fallback
    const productImageUrl =
      playwrightResult.productImageUrl ??
      pageAnalysis.productImageUrl ??
      undefined

    let basePriceSource: SanitizationResult["basePriceSource"] =
      pageAnalysis.basePrice && pageAnalysis.basePrice !== "unknown"
        ? "page-analysis"
        : playwrightResult.listedPrice &&
            playwrightResult.listedPrice !== "unknown"
          ? "playwright"
          : undefined

    let basePrice =
      pageAnalysis.basePrice ?? playwrightResult.listedPrice ?? "unknown"

    let basePriceConfidence: SanitizationResult["basePriceConfidence"] =
      basePriceSource === "playwright"
        ? "high"
        : basePriceSource === "page-analysis"
          ? "medium"
          : undefined

    if (!basePrice || basePrice === "unknown") {
      const fallback = await resolvePriceWithAiWebFallback(
        query,
        domain,
        (msg) => wrappedLog(msg, "action")
      )
      if (fallback.price) {
        basePrice = fallback.price
        basePriceSource = "ai-web-fallback"
        basePriceConfidence = fallback.confidence
        wrappedLog(
          `Price fallback found ${fallback.price}${fallback.sourceUrl ? ` from ${new URL(fallback.sourceUrl).hostname}` : ""}.`,
          "success"
        )
      } else {
        wrappedLog(
          "Price fallback could not confirm an exact item price from web evidence.",
          "warn"
        )
      }
    }

    const finalPrice = playwrightResult.cartTotal ?? basePrice

    const savings = allFees.reduce(
      (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, "") || "0"),
      0
    )

    onLog(
      savings > 0
        ? `Scan complete — ${allFees.length} fee(s) found, $${savings.toFixed(2)} stripped`
        : `Scan complete — no hidden fees detected (base price: ${basePrice})`,
      "success"
    )

    return {
      basePrice,
      basePriceSource,
      basePriceConfidence,
      finalPrice,
      junkFeesRemoved: allFees,
      productImageUrl,
      productUrl: sitePlan.productUrl !== url ? sitePlan.productUrl : undefined,
      trustScore: pageAnalysis.trustScore,
      fakeReviewsDetected: pageAnalysis.fakeReviewsDetected,
      productOrigin: pageAnalysis.productOrigin,
    }
  } catch (err) {
    clearTimers()
    throw err
  }
}
