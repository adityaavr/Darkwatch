/**
 * marketplace-comparison.ts
 *
 * Compares a product query across 4 relevant competitor marketplaces.
 * Uses Playwright to get REAL rendered prices and actual product thumbnails.
 * If a site blocks automation, marks it as unavailable (no guessed prices).
 */

import { chromium } from "playwright"
import type { Browser, Page } from "playwright"
import OpenAI from "openai"
import type { MarketplaceComparison, MarketplaceResult } from "./types"
import { planMarketplaceRecovery } from "./automation-router"

// ── Browser factory (intentionally duplicated from playwright-service to avoid circular imports) ──

async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  })
}

const STEALTH_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.207 Safari/537.36",
]
function pickUA() {
  return STEALTH_UAS[Math.floor(Math.random() * STEALTH_UAS.length)]
}

async function newPage(browser: Browser, slowMode = false): Promise<Page> {
  const ua = pickUA()
  const w = 1280 + Math.floor(Math.random() * 200)
  const h = 800 + Math.floor(Math.random() * 100)
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: w, height: h },
    locale: "en-US",
    colorScheme: "light",
    deviceScaleFactor: 1,
    hasTouch: false,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "sec-ch-ua":
        '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    })
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 })
    // @ts-expect-error custom chrome object for anti-detection
    window.chrome = {
      app: { isInstalled: false },
      runtime: {},
      loadTimes: () => ({}),
      csi: () => ({}),
    }
    const getParameter = WebGLRenderingContext.prototype.getParameter
    WebGLRenderingContext.prototype.getParameter = function (p: number) {
      if (p === 37445) return "Intel Inc."
      if (p === 37446) return "Intel Iris OpenGL Engine"
      return getParameter.call(this, p)
    }
  })
  const page = await context.newPage()
  if (slowMode) {
    await page.setViewportSize({ width: 1366, height: 900 })
  }
  // Block known bot-detection endpoints
  await page.route("**/*", async (route) => {
    if (
      /datadome\.co|perimeterx\.net|px-cdn\.net|kasada\.io/.test(
        route.request().url()
      )
    ) {
      await route.abort()
      return
    }
    await route.continue()
  })
  return page
}

// ── Competitor configurations ─────────────────────────────────────────────────

type Competitor = {
  marketplace: string
  domain: string
  emoji: string
  searchUrl: string
}

const enc = (q: string) => encodeURIComponent(q)

type MarketplaceTemplate = {
  marketplace: string
  domain: string
  emoji: string
  keywords: string[]
  weight: number
  buildSearchUrl: (query: string) => string
}

const MARKETPLACE_TEMPLATES: MarketplaceTemplate[] = [
  {
    marketplace: "Amazon",
    domain: "amazon.com",
    emoji: "📦",
    keywords: ["general", "electronics", "fashion", "home", "beauty", "toys"],
    weight: 1.0,
    buildSearchUrl: (q) => `https://www.amazon.com/s?k=${enc(q)}`,
  },
  {
    marketplace: "Walmart",
    domain: "walmart.com",
    emoji: "🏪",
    keywords: ["general", "grocery", "home", "electronics", "fashion", "kids"],
    weight: 0.95,
    buildSearchUrl: (q) => `https://www.walmart.com/search?q=${enc(q)}`,
  },
  {
    marketplace: "Target",
    domain: "target.com",
    emoji: "🎯",
    keywords: ["general", "home", "fashion", "beauty", "kids", "decor"],
    weight: 0.95,
    buildSearchUrl: (q) => `https://www.target.com/s?searchTerm=${enc(q)}`,
  },
  {
    marketplace: "Best Buy",
    domain: "bestbuy.com",
    emoji: "🔵",
    keywords: ["electronics", "laptop", "phone", "tv", "gaming", "appliance"],
    weight: 0.9,
    buildSearchUrl: (q) =>
      `https://www.bestbuy.com/site/searchpage.jsp?st=${enc(q)}`,
  },
  {
    marketplace: "Newegg",
    domain: "newegg.com",
    emoji: "🖥️",
    keywords: ["electronics", "computer", "gpu", "cpu", "monitor", "pc"],
    weight: 0.85,
    buildSearchUrl: (q) => `https://www.newegg.com/p/pl?d=${enc(q)}`,
  },
  {
    marketplace: "B&H",
    domain: "bhphotovideo.com",
    emoji: "📷",
    keywords: ["camera", "photo", "video", "lens", "audio", "electronics"],
    weight: 0.85,
    buildSearchUrl: (q) =>
      `https://www.bhphotovideo.com/c/search?q=${enc(q)}&sts=ma`,
  },
  {
    marketplace: "Wayfair",
    domain: "wayfair.com",
    emoji: "🏠",
    keywords: ["furniture", "home", "decor", "sofa", "bed", "table", "chair"],
    weight: 0.88,
    buildSearchUrl: (q) =>
      `https://www.wayfair.com/keyword.php?keyword=${enc(q)}`,
  },
  {
    marketplace: "IKEA",
    domain: "ikea.com",
    emoji: "🪑",
    keywords: ["furniture", "home", "storage", "desk", "chair", "bed"],
    weight: 0.86,
    buildSearchUrl: (q) => `https://www.ikea.com/us/en/search/?q=${enc(q)}`,
  },
  {
    marketplace: "Home Depot",
    domain: "homedepot.com",
    emoji: "🛠️",
    keywords: ["home", "tools", "appliance", "outdoor", "hardware", "garden"],
    weight: 0.8,
    buildSearchUrl: (q) => `https://www.homedepot.com/s/${enc(q)}`,
  },
  {
    marketplace: "ASOS",
    domain: "asos.com",
    emoji: "👗",
    keywords: [
      "fashion",
      "clothing",
      "dress",
      "shoes",
      "streetwear",
      "apparel",
    ],
    weight: 0.84,
    buildSearchUrl: (q) => `https://www.asos.com/search/?q=${enc(q)}`,
  },
  {
    marketplace: "Nordstrom",
    domain: "nordstrom.com",
    emoji: "🧥",
    keywords: [
      "fashion",
      "clothing",
      "luxury",
      "shoes",
      "beauty",
      "accessories",
    ],
    weight: 0.82,
    buildSearchUrl: (q) => `https://www.nordstrom.com/sr?keyword=${enc(q)}`,
  },
  {
    marketplace: "Macy's",
    domain: "macys.com",
    emoji: "🛍️",
    keywords: ["fashion", "home", "beauty", "clothing", "bags", "jewelry"],
    weight: 0.82,
    buildSearchUrl: (q) => `https://www.macys.com/shop/featured/${enc(q)}`,
  },
  {
    marketplace: "Etsy",
    domain: "etsy.com",
    emoji: "🎨",
    keywords: [
      "handmade",
      "custom",
      "gift",
      "craft",
      "jewelry",
      "vintage",
      "art",
    ],
    weight: 0.8,
    buildSearchUrl: (q) => `https://www.etsy.com/search?q=${enc(q)}`,
  },
  {
    marketplace: "eBay",
    domain: "ebay.com",
    emoji: "🏷️",
    keywords: [
      "general",
      "collectible",
      "used",
      "refurbished",
      "parts",
      "auction",
    ],
    weight: 0.76,
    buildSearchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}`,
  },
]

type BrandStoreRule = {
  brand: string
  aliases: string[]
  marketplace: string
  domain: string
  emoji: string
  buildSearchUrl: (query: string) => string
}

const BRAND_STORE_RULES: BrandStoreRule[] = [
  {
    brand: "Apple",
    aliases: ["apple", "iphone", "ipad", "macbook", "apple watch", "airpods"],
    marketplace: "Apple Store",
    domain: "apple.com",
    emoji: "🍎",
    buildSearchUrl: (q) => `https://www.apple.com/us/search/${enc(q)}?src=serp`,
  },
  {
    brand: "Samsung",
    aliases: ["samsung", "galaxy", "z fold", "z flip"],
    marketplace: "Samsung Store",
    domain: "samsung.com",
    emoji: "📱",
    buildSearchUrl: (q) =>
      `https://www.samsung.com/us/search/searchMain/?listType=g&searchTerm=${enc(q)}`,
  },
  {
    brand: "Nike",
    aliases: ["nike", "air jordan", "jordan", "dunk"],
    marketplace: "Nike",
    domain: "nike.com",
    emoji: "👟",
    buildSearchUrl: (q) => `https://www.nike.com/w?q=${enc(q)}&vst=${enc(q)}`,
  },
  {
    brand: "Adidas",
    aliases: ["adidas", "ultraboost", "yeezy"],
    marketplace: "Adidas",
    domain: "adidas.com",
    emoji: "👟",
    buildSearchUrl: (q) => `https://www.adidas.com/us/search?q=${enc(q)}`,
  },
  {
    brand: "Dyson",
    aliases: ["dyson", "airwrap", "supersonic", "v15"],
    marketplace: "Dyson",
    domain: "dyson.com",
    emoji: "🌀",
    buildSearchUrl: (q) =>
      `https://www.dyson.com/search-results?searchTerm=${enc(q)}`,
  },
]

function detectBrandStoreCandidates(query: string): Array<{
  competitor: Competitor
  brand: string
}> {
  const lower = query.toLowerCase()
  return BRAND_STORE_RULES.filter((r) =>
    r.aliases.some((a) => lower.includes(a))
  ).map((r) => ({
    brand: r.brand,
    competitor: {
      marketplace: r.marketplace,
      domain: r.domain,
      emoji: r.emoji,
      searchUrl: r.buildSearchUrl(query),
    },
  }))
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

function scoreMarketplace(
  profile: MarketplaceTemplate,
  query: string,
  tokens: string[]
): number {
  const lower = query.toLowerCase()
  let score = profile.weight

  for (const keyword of profile.keywords) {
    if (tokens.includes(keyword)) score += 2.4
    else if (tokens.some((t) => t.startsWith(keyword) || keyword.startsWith(t)))
      score += 0.7
  }

  if (/dress|shirt|jeans|hoodie|sneaker|fashion|apparel/.test(lower)) {
    if (
      ["ASOS", "Nordstrom", "Macy's", "Amazon", "Target"].includes(
        profile.marketplace
      )
    )
      score += 1.6
  }
  if (/camera|lens|microphone|tripod|gimbal|photo|video/.test(lower)) {
    if (["B&H", "Best Buy", "Amazon"].includes(profile.marketplace))
      score += 1.8
  }
  if (/gpu|cpu|ssd|laptop|monitor|keyboard|mouse|pc/.test(lower)) {
    if (["Newegg", "Best Buy", "Amazon"].includes(profile.marketplace))
      score += 1.8
  }
  if (
    /sofa|table|chair|desk|bed|mattress|furniture|decor|cabinet/.test(lower)
  ) {
    if (
      ["Wayfair", "IKEA", "Home Depot", "Target", "Walmart"].includes(
        profile.marketplace
      )
    )
      score += 1.7
  }
  if (/handmade|custom|vintage|engraved|personalized|gift/.test(lower)) {
    if (["Etsy", "eBay", "Amazon"].includes(profile.marketplace)) score += 1.7
  }

  return score
}

type CompetitorSelection = {
  competitor: Competitor
  score: number
  reasons: string[]
}

async function selectCompetitorsSmart(
  query: string,
  currentDomain: string,
  onLog: (msg: string) => void
): Promise<CompetitorSelection[]> {
  const ranked = rankCompetitors(query, currentDomain)
  const shortlist = ranked.slice(0, 10)

  if (!process.env.OPENAI_API_KEY) return ranked.slice(0, 5)

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    onLog("Routing marketplaces with AI intent planner...")

    const prompt = `You are selecting the best e-commerce marketplaces to compare prices.

Query: ${query}
Current site domain (exclude this): ${currentDomain}

Candidates:
${JSON.stringify(
  shortlist.map((s) => ({
    marketplace: s.competitor.marketplace,
    domain: s.competitor.domain,
    heuristicScore: Number(s.score.toFixed(2)),
    heuristicReasons: s.reasons,
  })),
  null,
  2
)}

Rules:
- Return 5 marketplaces max.
- Prefer official brand stores when clearly relevant (e.g. Apple Watch -> Apple Store).
- Keep mix of specialist + broad retailers.
- Do not include duplicates.

Return strict JSON only:
{
  "selected": [
    { "marketplace": "name", "reason": "short reason" }
  ]
}`

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 380,
    })

    const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as {
      selected?: Array<{ marketplace?: string; reason?: string }>
    }

    const selectedNames = new Set(
      (parsed.selected ?? [])
        .map((s) => (s.marketplace ?? "").trim())
        .filter(Boolean)
    )

    const selected: CompetitorSelection[] = []
    for (const name of selectedNames) {
      const match = shortlist.find((s) => s.competitor.marketplace === name)
      if (!match) continue
      const reason =
        parsed.selected?.find((s) => s.marketplace === name)?.reason?.trim() ||
        match.reasons[0] ||
        "AI-selected"
      selected.push({ ...match, reasons: [reason, ...match.reasons] })
    }

    for (const h of shortlist) {
      if (selected.length >= 5) break
      if (
        selected.some(
          (s) => s.competitor.marketplace === h.competitor.marketplace
        )
      )
        continue
      selected.push(h)
    }

    return selected.slice(0, 5)
  } catch {
    onLog("AI marketplace router unavailable, using heuristic ranking.")
    return ranked.slice(0, 5)
  }
}

function rankCompetitors(
  query: string,
  currentDomain: string
): CompetitorSelection[] {
  const cleanCurrent = currentDomain.replace(/^www\./, "")
  const tokens = tokenizeQuery(query)
  const lower = query.toLowerCase()
  const brandCandidates = detectBrandStoreCandidates(query)

  const brandSelections: CompetitorSelection[] = brandCandidates
    .filter(
      (b) =>
        !cleanCurrent.includes(b.competitor.domain) &&
        !b.competitor.domain.includes(cleanCurrent)
    )
    .map((b) => ({
      competitor: b.competitor,
      score: 99,
      reasons: ["official brand store match", `${b.brand} direct pricing`],
    }))

  const rankedBase = MARKETPLACE_TEMPLATES.filter(
    (m) => !cleanCurrent.includes(m.domain) && !m.domain.includes(cleanCurrent)
  )
    .map((m) => {
      const reasons: string[] = []
      const matched = m.keywords.filter((k) => tokens.includes(k))
      if (matched.length > 0)
        reasons.push(`keyword match: ${matched.slice(0, 2).join(", ")}`)
      if (
        /camera|photo|video|lens/.test(lower) &&
        ["B&H", "Best Buy"].includes(m.marketplace)
      ) {
        reasons.push("camera/electronics specialist")
      }
      if (
        /furniture|sofa|desk|chair|bed|decor/.test(lower) &&
        ["Wayfair", "IKEA", "Home Depot"].includes(m.marketplace)
      ) {
        reasons.push("home/furniture specialist")
      }
      if (
        /fashion|dress|shirt|jeans|shoes/.test(lower) &&
        ["ASOS", "Nordstrom", "Macy's"].includes(m.marketplace)
      ) {
        reasons.push("fashion specialist")
      }
      if (reasons.length === 0) reasons.push("general catalog coverage")

      return {
        competitor: {
          marketplace: m.marketplace,
          domain: m.domain,
          emoji: m.emoji,
          searchUrl: m.buildSearchUrl(query),
        },
        score: scoreMarketplace(m, query, tokens),
        reasons,
      }
    })
    .sort((a, b) => b.score - a.score)

  const merged = [...brandSelections, ...rankedBase]
  const seen = new Set<string>()
  const deduped: CompetitorSelection[] = []
  for (const r of merged) {
    const key = r.competitor.domain
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(r)
  }

  return deduped.sort((a, b) => b.score - a.score)
}

export function pickCompetitors(
  query: string,
  currentDomain: string
): Competitor[] {
  return rankCompetitors(query, currentDomain)
    .slice(0, 5)
    .map((r) => r.competitor)
}

// ── Per-marketplace product extraction ───────────────────────────────────────
// Extracts name, price, thumbnail, and product URL from the best-matching visible result.

type ExtractedProduct = {
  name: string
  price: string
  thumbnailUrl: string
  productPageUrl: string
  pageText: string // raw text for GPT-4o context
  blockedByVerification: boolean
}

async function extractFromPage(
  page: Page,
  marketplace: string,
  searchUrl: string,
  query: string,
  opts?: { slowMode?: boolean }
): Promise<ExtractedProduct> {
  try {
    const slowMode = Boolean(opts?.slowMode)
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: slowMode ? 35_000 : 22_000,
    })
    // Human-like: pause then scroll before scraping
    await page.waitForTimeout(800 + Math.floor(Math.random() * 600))
    await page.evaluate(() =>
      window.scrollBy({
        top: 200 + Math.floor(Math.random() * 200),
        behavior: "smooth",
      })
    )
    await page.waitForTimeout(600 + Math.floor(Math.random() * 400))

    if (slowMode) {
      await page.mouse.move(180, 220, { steps: 16 })
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        window.scrollBy({ top: 320, behavior: "smooth" })
      })
      await page.waitForTimeout(1300)
      await page.mouse.move(640, 380, { steps: 20 })
      await page.waitForTimeout(800)
    }

    // Dismiss cookie/overlay if present
    for (const sel of [
      "#onetrust-accept-btn-handler",
      ".cc-btn.cc-allow",
      '[aria-label="Close"]',
      '[data-testid="close-button"]',
    ]) {
      try {
        const el = page.locator(sel).first()
        if (await el.isVisible({ timeout: 500 })) {
          await el.click()
          await page.waitForTimeout(300)
        }
      } catch {
        /* skip */
      }
    }

    const extractOnce = async () =>
      page.evaluate(
        ({
          mp,
          q,
        }: {
          mp: string
          q: string
        }): {
          name: string
          price: string
          thumbnailUrl: string
          productPageUrl: string
        } => {
          // Marketplace-specific selectors for first product card
          const configs: Record<
            string,
            {
              cards: string
              name: string
              price: string
              img: string
              link: string
            }
          > = {
            Amazon: {
              cards: '[data-component-type="s-search-result"]',
              name: "h2 .a-size-medium, h2 .a-size-base-plus, h2 span",
              price: ".a-price .a-offscreen, .a-price-whole",
              img: "img.s-image",
              link: "h2 a.a-link-normal",
            },
            eBay: {
              cards: ".s-item:not(.s-item--watch-at-corner)",
              name: ".s-item__title",
              price: ".s-item__price",
              img: '.s-item__image-img, img[src*="ebayimg"]',
              link: "a.s-item__link",
            },
            Etsy: {
              cards: '[data-search-results-row] li, [class*="wt-grid"] li',
              name: 'h3, [class*="title"]',
              price: '[class*="currency-value"], [class*="Price"]',
              img: 'img[src*="etsystatic"], img[data-src*="etsystatic"]',
              link: 'a[href*="/listing/"]',
            },
            ASOS: {
              cards: 'article[class*="product"], [class*="productInfo"]',
              name: '[class*="productDescription"], p[class]',
              price: '[class*="price"]',
              img: 'img[src*="asos-media"], img[class*="image"]',
              link: 'a[href*="/prd/"]',
            },
            Target: {
              cards: '[data-test="product-list-item"]',
              name: '[data-test="product-title"]',
              price: '[data-test="current-price"]',
              img: 'img[src*="target.scene7"], img[src*="assets.target"]',
              link: 'a[href*="/p/"]',
            },
            Walmart: {
              cards: '[data-testid="list-view"]',
              name: '[data-automation-id="product-title"]',
              price: '[itemprop="price"], [class*="price-characteristic"]',
              img: 'img[src*="i5.walmartimages"]',
              link: 'a[href*="/ip/"]',
            },
            Temu: {
              cards: '[class*="goods-card"], [class*="search-product"]',
              name: '[class*="goods-title"], [class*="product-title"]',
              price: '[class*="goods-price"], [class*="price-amount"]',
              img: 'img[src*="img.kwcdn"], img[class*="goods-img"]',
              link: 'a[href*="/goods"]',
            },
            Wayfair: {
              cards: '[class*="ProductCard"]',
              name: '[class*="ProductCard-name"], a[class*="name"]',
              price: '[class*="ProductPrice"]',
              img: 'img[src*="secure.img1-fg"]',
              link: 'a[href*="/sb/"]',
            },
            Nordstrom: {
              cards: '[data-testid="product-thumbnail"], article',
              name: '[data-testid="product-thumbnail-name"], h3, h2',
              price: '[data-testid="product-price"], [class*="price"]',
              img: 'img[src*="nordstrommedia"]',
              link: 'a[href*="/s/"]',
            },
            "Macy's": {
              cards: '[class*="productThumbnail"], article',
              name: '[class*="productDescription"], h3, h2',
              price: '[class*="price"], [class*="regular"]',
              img: 'img[src*="macysassets"]',
              link: 'a[href*="/shop/product/"]',
            },
            IKEA: {
              cards: '[data-type="PRODUCT"], [class*="plp-product"]',
              name: '[data-testid="plp-product-name"], h3, h2',
              price: '[data-testid="price"] [class*="price"], [class*="price"]',
              img: 'img[src*="ikea"]',
              link: 'a[href*="/p/"]',
            },
            "Home Depot": {
              cards: '[data-testid="product-pod"], [class*="product-pod"]',
              name: '[data-testid="product-title"], h3, h2',
              price: '[data-testid="price-format-wrapper"], [class*="price"]',
              img: 'img[src*="homedepot-static"]',
              link: 'a[href*="/p/"]',
            },
            Newegg: {
              cards: '.item-cell, [class*="item-cell"]',
              name: ".item-title, h3, h2",
              price: '.price-current, [class*="price-current"]',
              img: 'img[src*="neweggimages"]',
              link: "a.item-title",
            },
            "B&H": {
              cards: '[data-selenium="miniProductPage"], article',
              name: '[data-selenium="miniProductPageProductName"], h3, h2',
              price:
                '[data-selenium="uppedDecimalPriceFirst"], [class*="price"]',
              img: 'img[src*="bhphotovideo"]',
              link: 'a[href*="/c/product/"]',
            },
            "Best Buy": {
              cards: ".sku-item",
              name: ".sku-title a",
              price: ".priceView-customer-price span",
              img: "img.product-image",
              link: "a.image-link, a.sku-header",
            },
          }
          const cfg = configs[mp] ?? {
            cards: '[class*="product"], article',
            name: "h3, h2",
            price: '[class*="price"]',
            img: "img",
            link: "a",
          }

          const queryTokens = q
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((t) => t.length > 2)

          const cards = Array.from(document.querySelectorAll(cfg.cards)).slice(
            0,
            12
          )

          const candidates = cards
            .map((card) => {
              const name =
                (card.querySelector(cfg.name) as HTMLElement)?.innerText
                  ?.trim()
                  .slice(0, 120) ?? ""
              const price =
                (card.querySelector(cfg.price) as HTMLElement)?.innerText
                  ?.trim()
                  .split("\n")[0] ?? ""

              const imgEl = card.querySelector(
                cfg.img
              ) as HTMLImageElement | null
              const thumbnailUrl =
                (imgEl?.src?.startsWith("http") ? imgEl.src : "") ||
                imgEl?.getAttribute("data-src") ||
                imgEl?.getAttribute("srcset")?.split(" ")[0] ||
                ""

              const linkEl = card.querySelector(
                cfg.link
              ) as HTMLAnchorElement | null
              const productPageUrl = linkEl?.href ?? ""

              const lowerName = name.toLowerCase()
              const tokenHits = queryTokens.filter(
                (t) =>
                  lowerName.includes(t) ||
                  t.includes(lowerName.split(" ")[0] ?? "")
              ).length
              const hasPrice = /[$£€]\s*[\d,.]+/.test(price)
              const hasImage = thumbnailUrl.startsWith("http")
              const hasLink = productPageUrl.length > 0

              const score =
                tokenHits * 3 +
                (hasPrice ? 2 : 0) +
                (hasImage ? 1 : 0) +
                (hasLink ? 1 : 0) +
                (name ? 1 : 0)

              return { name, price, thumbnailUrl, productPageUrl, score }
            })
            .filter((c) => c.name || c.price)

          if (candidates.length === 0) {
            return { name: "", price: "", thumbnailUrl: "", productPageUrl: "" }
          }

          const best = candidates.sort((a, b) => b.score - a.score)[0]
          return {
            name: best.name.slice(0, 80),
            price: best.price,
            thumbnailUrl: best.thumbnailUrl,
            productPageUrl: best.productPageUrl,
          }
        },
        { mp: marketplace, q: query }
      )

    const scoreExtracted = (p: {
      name: string
      price: string
      thumbnailUrl: string
      productPageUrl: string
    }): number => {
      const hasPrice = normalizePrice(p.price) !== ""
      const hasName = p.name.trim().length > 0
      const hasThumb = p.thumbnailUrl.startsWith("http")
      const hasLink = p.productPageUrl.length > 0
      return (
        (hasPrice ? 5 : 0) +
        (hasName ? 2 : 0) +
        (hasThumb ? 1 : 0) +
        (hasLink ? 1 : 0)
      )
    }

    let result = await extractOnce()

    // Deep scan: sample additional viewport windows when price is still missing
    if (normalizePrice(result.price) === "") {
      let best = result
      for (let pass = 0; pass < 2; pass++) {
        await page.evaluate(
          (n) => {
            window.scrollBy({ top: n, behavior: "smooth" })
          },
          700 + pass * 450
        )
        await page.waitForTimeout(850 + pass * 300)
        const next = await extractOnce()
        if (scoreExtracted(next) > scoreExtracted(best)) best = next
        if (normalizePrice(best.price) !== "") break
      }
      result = best
    }

    // If listing cards still don't expose price, open the matched product page and try PDP extraction
    if (normalizePrice(result.price) === "" && result.productPageUrl) {
      try {
        await page.goto(result.productPageUrl, {
          waitUntil: "domcontentloaded",
          timeout: slowMode ? 32_000 : 20_000,
        })
        await page.waitForTimeout(1000)
        const pdpPrice = await page.evaluate((): string => {
          const directSelectors = [
            '[itemprop="price"]',
            '[data-testid*="price"]',
            '[class*="price"]',
            'meta[property="product:price:amount"]',
            'meta[itemprop="price"]',
          ]

          for (const sel of directSelectors) {
            const el = document.querySelector(sel)
            if (!el) continue
            const content =
              (el as HTMLMetaElement).content ||
              (el as HTMLElement).innerText ||
              el.getAttribute("content") ||
              el.getAttribute("aria-label") ||
              ""
            const hit =
              content.match(/[$£€]\s*[\d,.]+(?:\.\d{1,2})?/) ||
              content.match(/\b\d+[\d,.]*\.?\d{0,2}\b/)
            if (hit) return hit[0]
          }

          const scripts = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]')
          )
          for (const s of scripts) {
            const txt = s.textContent || ""
            const hit = txt.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/)
            if (hit) return `$${hit[1]}`
          }

          const bodyText = document.body.innerText.replace(/\s+/g, " ")
          const textHit = bodyText.match(/[$£€]\s*[\d,.]+(?:\.\d{1,2})?/)
          return textHit ? textHit[0] : ""
        })

        if (normalizePrice(pdpPrice) !== "") {
          result = { ...result, price: pdpPrice }
        }
      } catch {
        // keep best-effort listing result
      }
    }

    // Fall back to page text for GPT-4o if selectors miss
    const pageText = await page.evaluate((): string =>
      document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 2500)
    )

    const blockedByVerification =
      /verify you are human|verify you'?re human|captcha|robot|access denied|just a moment|security check|unusual traffic/i.test(
        pageText
      )

    return { ...result, pageText, blockedByVerification }
  } catch {
    return {
      name: "",
      price: "",
      thumbnailUrl: "",
      productPageUrl: "",
      pageText: "",
      blockedByVerification: false,
    }
  }
}

function parsePriceNumber(raw: string): number | null {
  const m = raw.match(/[$£€]\s*([\d,.]+)/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function normalizePrice(raw: string): string {
  const m = raw.match(/[$£€]\s*[\d,.]+(?:\.\d{1,2})?/)
  return m ? m[0].replace(/\s+/g, "") : ""
}

function mapExtractedToResult(
  competitor: Competitor,
  product: ExtractedProduct,
  verdict: MarketplaceResult["verdict"],
  verdictReason: string
): MarketplaceResult {
  const visiblePrice = normalizePrice(product.price)
  const blockedByVerification = product.blockedByVerification
  const missingPrice = !visiblePrice

  const dataConfidence: MarketplaceResult["dataConfidence"] = !missingPrice
    ? "verified-live"
    : blockedByVerification
      ? "blocked"
      : "unverified"

  const dataSourceNote =
    dataConfidence === "verified-live"
      ? "Price captured from rendered page with Playwright."
      : dataConfidence === "blocked"
        ? "Automation hit human verification wall; no live price captured."
        : "Page loaded but no clear first-result price could be extracted."

  return {
    marketplace: competitor.marketplace,
    domain: competitor.domain,
    emoji: competitor.emoji,
    searchUrl: competitor.searchUrl,
    topResultName:
      product.name?.slice(0, 50) ||
      (blockedByVerification
        ? "Verification wall encountered"
        : "Top result unavailable"),
    priceRange: visiblePrice || "unknown",
    rating: "",
    shippingNote: blockedByVerification ? "Verification required" : "",
    verdict,
    verdictReason,
    dataConfidence,
    dataSourceNote,
    thumbnailUrl: product.thumbnailUrl || undefined,
    productPageUrl: product.productPageUrl || undefined,
  }
}

// ── Main comparison function ───────────────────────────────────────────────────

export async function compareMarketplaces(
  query: string,
  currentDomain: string,
  currentPrice: string,
  onLog: (msg: string) => void,
  onScreenshot?: (dataUrl: string, label: string, streamId?: string) => void
): Promise<MarketplaceComparison> {
  const ranked = await selectCompetitorsSmart(query, currentDomain, onLog)
  const competitors = ranked.map((r) => r.competitor)
  if (competitors.length === 0)
    throw new Error("No competitor marketplaces selected")

  onLog(
    `Comparing "${query}" across ${competitors.map((c) => c.marketplace).join(", ")}...`
  )
  onLog("Marketplace targeting rationale:")
  for (const r of ranked.slice(0, 5)) {
    onLog(
      `  ↳ ${r.competitor.marketplace} (${r.score.toFixed(2)}): ${r.reasons.join("; ")}`
    )
  }

  const browser = await launchBrowser()
  try {
    // Visit all competitors in parallel — one browser context/page per site
    onLog(`  ↳ Opening ${competitors.length} marketplace pages in parallel...`)
    const settled = await Promise.allSettled(
      competitors.map(async (c) => {
        const page = await newPage(browser)
        try {
          if (onScreenshot) {
            try {
              const warmup = await page.screenshot({
                type: "jpeg",
                quality: 50,
                timeout: 1500,
              })
              onScreenshot(
                `data:image/jpeg;base64,${warmup.toString("base64")}`,
                `🧭 MARKET AGENT · ${c.marketplace}`,
                `market-${c.marketplace.toLowerCase().replace(/\s+/g, "-")}`
              )
            } catch {
              // ignore
            }
          }
          const product = await extractFromPage(
            page,
            c.marketplace,
            c.searchUrl,
            query
          )
          if (onScreenshot) {
            try {
              const shot = await page.screenshot({
                type: "jpeg",
                quality: 55,
                timeout: 2000,
              })
              onScreenshot(
                `data:image/jpeg;base64,${shot.toString("base64")}`,
                `🧭 MARKET AGENT · ${c.marketplace}`,
                `market-${c.marketplace.toLowerCase().replace(/\s+/g, "-")}`
              )
            } catch {
              // ignore
            }
          }
          return { competitor: c, product }
        } finally {
          await page
            .context()
            .close()
            .catch(() => {
              /* ignore */
            })
        }
      })
    )

    const extracted: Array<{
      competitor: Competitor
      product: ExtractedProduct
    }> = []
    for (let i = 0; i < competitors.length; i++) {
      const s = settled[i]
      if (s.status === "fulfilled") {
        const state = s.value.product.blockedByVerification
          ? "blocked by verification"
          : s.value.product.price || "price unknown"
        onLog(`  ↳ ${s.value.competitor.marketplace}: ${state}`)
        extracted.push(s.value)
      } else {
        onLog(`  ↳ ${competitors[i].marketplace}: unavailable`)
        extracted.push({
          competitor: competitors[i],
          product: {
            name: "",
            price: "",
            thumbnailUrl: "",
            productPageUrl: "",
            pageText: "",
            blockedByVerification: false,
          },
        })
      }
    }

    // Build honest result set directly from extracted live data (no hallucinated prices)
    const priced = extracted
      .map((e) => ({ ...e, numeric: parsePriceNumber(e.product.price) }))
      .filter((e) => e.numeric != null) as Array<{
      competitor: Competitor
      product: ExtractedProduct
      numeric: number
    }>

    const winnerEntry = priced.slice().sort((a, b) => a.numeric - b.numeric)[0]
    const winner =
      winnerEntry?.competitor.marketplace ?? competitors[0].marketplace
    const lowest = winnerEntry?.numeric ?? null
    const current = parsePriceNumber(currentPrice)

    const results: MarketplaceResult[] = extracted.map(
      ({ competitor: c, product: p }) => {
        const visiblePrice = normalizePrice(p.price)
        const numeric = parsePriceNumber(visiblePrice)
        const blockedByVerification = p.blockedByVerification
        const missingPrice = !visiblePrice
        const blocked = blockedByVerification || missingPrice

        let verdict: MarketplaceResult["verdict"] = "comparable"
        let verdictReason = "Price unavailable from live scrape."

        if (blocked) {
          verdict = "comparable"
          verdictReason = blockedByVerification
            ? "Human verification blocked automated price read."
            : "No visible price found on first result card."
        } else if (
          winnerEntry &&
          c.marketplace === winnerEntry.competitor.marketplace
        ) {
          verdict = "best-value"
          verdictReason = "Lowest live price among checked marketplaces."
        } else if (lowest != null && numeric != null) {
          const deltaPct = ((numeric - lowest) / lowest) * 100
          if (deltaPct > 20) {
            verdict = "premium"
            verdictReason = `About ${Math.round(deltaPct)}% above lowest observed price.`
          } else {
            verdict = "comparable"
            verdictReason = `Within ${Math.max(1, Math.round(Math.abs(deltaPct)))}% of lowest observed price.`
          }
        }

        return mapExtractedToResult(c, p, verdict, verdictReason)
      }
    )

    let currentSiteVerdict: MarketplaceComparison["currentSiteVerdict"] = "fair"
    let currentSiteNote =
      "Not enough live competitor price data to conclude yet."

    if (current != null && lowest != null) {
      const deltaPct = ((current - lowest) / lowest) * 100
      if (deltaPct <= 5) {
        currentSiteVerdict = "good-deal"
        currentSiteNote = `${currentDomain} is close to the best live price seen.`
      } else if (deltaPct <= 15) {
        currentSiteVerdict = "fair"
        currentSiteNote = `${currentDomain} is somewhat higher than the lowest observed option.`
      } else {
        currentSiteVerdict = "overpriced"
        currentSiteNote = `${currentDomain} appears significantly pricier than available alternatives.`
      }
    }

    const knownCount = results.filter((r) => r.priceRange !== "unknown").length
    const blockedCount = results.length - knownCount
    const summary =
      knownCount === 0
        ? "All marketplace checks were blocked or lacked visible prices, so no fair comparison is available."
        : `Observed ${knownCount}/${results.length} live marketplace price${knownCount === 1 ? "" : "s"}${blockedCount > 0 ? ` (${blockedCount} blocked/unavailable)` : ""}.`

    const recoveryPlans = await planMarketplaceRecovery(
      query,
      results
        .filter(
          (r) =>
            r.dataConfidence === "blocked" || r.dataConfidence === "unverified"
        )
        .map((r) => ({
          marketplace: r.marketplace,
          status: r.dataConfidence as "blocked" | "unverified",
          note: r.dataSourceNote,
        })),
      onLog
    )

    const verdictLog =
      currentSiteVerdict === "overpriced"
        ? "⚠ overpriced"
        : currentSiteVerdict === "fair"
          ? "fair price"
          : "✓ good deal"
    onLog(
      `Marketplace comparison: ${winner} wins from live data · ${currentDomain} is ${verdictLog}`
    )

    return {
      results,
      winner,
      summary,
      currentSiteVerdict,
      currentSiteNote,
      recoveryPlans,
    }
  } finally {
    await browser.close()
  }
}

export async function retryMarketplaceSlowMode(
  query: string,
  currentDomain: string,
  marketplace: string,
  onLog: (msg: string) => void,
  onScreenshot?: (dataUrl: string, label: string, streamId?: string) => void
): Promise<MarketplaceResult | null> {
  const competitors = pickCompetitors(query, currentDomain)
  const target = competitors.find((c) => c.marketplace === marketplace)
  if (!target) return null

  const browser = await launchBrowser()
  try {
    onLog(`Retrying ${target.marketplace} in slow human mode...`)
    const page = await newPage(browser, true)
    try {
      const streamId = `market-${target.marketplace.toLowerCase().replace(/\s+/g, "-")}`
      const warmup = await page.screenshot({
        type: "jpeg",
        quality: 50,
        timeout: 1500,
      })
      onScreenshot?.(
        `data:image/jpeg;base64,${warmup.toString("base64")}`,
        `🧭 MARKET AGENT · ${target.marketplace} · Slow mode`,
        streamId
      )

      const product = await extractFromPage(
        page,
        target.marketplace,
        target.searchUrl,
        query,
        { slowMode: true }
      )

      const shot = await page.screenshot({
        type: "jpeg",
        quality: 58,
        timeout: 2000,
      })
      onScreenshot?.(
        `data:image/jpeg;base64,${shot.toString("base64")}`,
        `🧭 MARKET AGENT · ${target.marketplace} · Slow mode`,
        streamId
      )

      const verdictReason =
        normalizePrice(product.price) !== ""
          ? "Live price captured on slow-mode retry."
          : product.blockedByVerification
            ? "Still blocked by human verification after retry."
            : "Retry completed, but price is still unclear across top results."

      return mapExtractedToResult(target, product, "comparable", verdictReason)
    } finally {
      await page
        .context()
        .close()
        .catch(() => {
          // ignore
        })
    }
  } finally {
    await browser.close()
  }
}
