/**
 * marketplace-comparison.ts
 *
 * Compares a product query across 4 relevant competitor marketplaces.
 * Uses Playwright to get REAL rendered prices and actual product thumbnails.
 * If a site blocks automation, marks it as unavailable (no guessed prices).
 */

import type { Browser, Page } from "playwright-core"
import OpenAI from "openai"
import type { MarketplaceComparison, MarketplaceResult } from "./types"
import { planMarketplaceRecovery } from "./automation-router"
import { launchPlaywrightBrowser } from "./playwright-launch"

// ── Browser factory (intentionally duplicated from playwright-service to avoid circular imports) ──

async function launchBrowser(): Promise<Browser> {
  return launchPlaywrightBrowser({
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
  regions: string[] // which markets this store serves — "global" means always eligible
  buildSearchUrl: (query: string) => string
}

// Full catalogue — region-tagged so GPT gets the right shortlist for the market.
// Region is inferred from the scanned domain's TLD/brand — no user location collected.
const MARKETPLACE_TEMPLATES: MarketplaceTemplate[] = [
  // ── Global anchors (always eligible) ─────────────────────────────────────────
  { marketplace: "Amazon", domain: "amazon.com", emoji: "📦", regions: ["us", "global"], buildSearchUrl: (q) => `https://www.amazon.com/s?k=${enc(q)}` },
  { marketplace: "eBay", domain: "ebay.com", emoji: "🏷️", regions: ["us", "global"], buildSearchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}` },
  { marketplace: "AliExpress", domain: "aliexpress.com", emoji: "🛒", regions: ["global", "sg", "my", "ph", "au", "uk", "eu"], buildSearchUrl: (q) => `https://www.aliexpress.com/wholesale?SearchText=${enc(q)}` },
  { marketplace: "Etsy", domain: "etsy.com", emoji: "🎨", regions: ["global"], buildSearchUrl: (q) => `https://www.etsy.com/search?q=${enc(q)}` },
  { marketplace: "ASOS", domain: "asos.com", emoji: "👗", regions: ["global", "uk", "au", "us", "sg"], buildSearchUrl: (q) => `https://www.asos.com/search/?q=${enc(q)}` },
  { marketplace: "Uniqlo", domain: "uniqlo.com", emoji: "🏷️", regions: ["global", "sg", "jp", "au", "uk", "us"], buildSearchUrl: (q) => `https://www.uniqlo.com/us/en/search?q=${enc(q)}` },
  { marketplace: "iHerb", domain: "iherb.com", emoji: "🌿", regions: ["global"], buildSearchUrl: (q) => `https://www.iherb.com/search?kw=${enc(q)}` },
  { marketplace: "Zara", domain: "zara.com", emoji: "🧣", regions: ["global"], buildSearchUrl: (q) => `https://www.zara.com/us/en/search?searchTerm=${enc(q)}` },
  { marketplace: "H&M", domain: "hm.com", emoji: "👚", regions: ["global"], buildSearchUrl: (q) => `https://www2.hm.com/en_us/search-results.html?q=${enc(q)}` },

  // ── United States ─────────────────────────────────────────────────────────────
  { marketplace: "Walmart", domain: "walmart.com", emoji: "🏪", regions: ["us"], buildSearchUrl: (q) => `https://www.walmart.com/search?q=${enc(q)}` },
  { marketplace: "Target", domain: "target.com", emoji: "🎯", regions: ["us"], buildSearchUrl: (q) => `https://www.target.com/s?searchTerm=${enc(q)}` },
  { marketplace: "Best Buy", domain: "bestbuy.com", emoji: "🔵", regions: ["us"], buildSearchUrl: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${enc(q)}` },
  { marketplace: "Newegg", domain: "newegg.com", emoji: "🖥️", regions: ["us"], buildSearchUrl: (q) => `https://www.newegg.com/p/pl?d=${enc(q)}` },
  { marketplace: "B&H", domain: "bhphotovideo.com", emoji: "📷", regions: ["us"], buildSearchUrl: (q) => `https://www.bhphotovideo.com/c/search?q=${enc(q)}&sts=ma` },
  { marketplace: "Nordstrom", domain: "nordstrom.com", emoji: "🧥", regions: ["us"], buildSearchUrl: (q) => `https://www.nordstrom.com/sr?keyword=${enc(q)}` },
  { marketplace: "Macy's", domain: "macys.com", emoji: "🛍️", regions: ["us"], buildSearchUrl: (q) => `https://www.macys.com/shop/featured/${enc(q)}` },
  { marketplace: "Wayfair", domain: "wayfair.com", emoji: "🏠", regions: ["us", "uk"], buildSearchUrl: (q) => `https://www.wayfair.com/keyword.php?keyword=${enc(q)}` },
  { marketplace: "Home Depot", domain: "homedepot.com", emoji: "🛠️", regions: ["us"], buildSearchUrl: (q) => `https://www.homedepot.com/s/${enc(q)}` },
  { marketplace: "Sephora", domain: "sephora.com", emoji: "💄", regions: ["us", "uk", "au", "sg"], buildSearchUrl: (q) => `https://www.sephora.com/search?keyword=${enc(q)}` },
  { marketplace: "Ulta", domain: "ulta.com", emoji: "💅", regions: ["us"], buildSearchUrl: (q) => `https://www.ulta.com/search?searchterm=${enc(q)}` },
  { marketplace: "REI", domain: "rei.com", emoji: "🏕️", regions: ["us"], buildSearchUrl: (q) => `https://www.rei.com/search?q=${enc(q)}` },
  { marketplace: "Back Market", domain: "backmarket.com", emoji: "♻️", regions: ["us", "uk", "eu"], buildSearchUrl: (q) => `https://www.backmarket.com/en-us/search?q=${enc(q)}` },
  { marketplace: "Boohoo", domain: "boohoo.com", emoji: "👗", regions: ["us", "uk"], buildSearchUrl: (q) => `https://www.boohoo.com/search?q=${enc(q)}` },
  { marketplace: "Nike", domain: "nike.com", emoji: "👟", regions: ["global"], buildSearchUrl: (q) => `https://www.nike.com/w?q=${enc(q)}&vst=${enc(q)}` },
  { marketplace: "Adidas", domain: "adidas.com", emoji: "👟", regions: ["global"], buildSearchUrl: (q) => `https://www.adidas.com/us/search?q=${enc(q)}` },
  { marketplace: "Apple Store", domain: "apple.com", emoji: "🍎", regions: ["global"], buildSearchUrl: (q) => `https://www.apple.com/us/search/${enc(q)}?src=serp` },
  { marketplace: "Samsung Store", domain: "samsung.com", emoji: "📱", regions: ["global"], buildSearchUrl: (q) => `https://www.samsung.com/us/search/searchMain/?listType=g&searchTerm=${enc(q)}` },
  { marketplace: "Dyson", domain: "dyson.com", emoji: "🌀", regions: ["global"], buildSearchUrl: (q) => `https://www.dyson.com/search-results?searchTerm=${enc(q)}` },
  { marketplace: "Lululemon", domain: "lululemon.com", emoji: "🧘", regions: ["us", "au", "uk", "sg"], buildSearchUrl: (q) => `https://shop.lululemon.com/search?Ntt=${enc(q)}` },
  { marketplace: "IKEA", domain: "ikea.com", emoji: "🪑", regions: ["global"], buildSearchUrl: (q) => `https://www.ikea.com/us/en/search/?q=${enc(q)}` },

  // ── United Kingdom ────────────────────────────────────────────────────────────
  { marketplace: "Amazon UK", domain: "amazon.co.uk", emoji: "📦", regions: ["uk"], buildSearchUrl: (q) => `https://www.amazon.co.uk/s?k=${enc(q)}` },
  { marketplace: "Argos", domain: "argos.co.uk", emoji: "🏬", regions: ["uk"], buildSearchUrl: (q) => `https://www.argos.co.uk/search/${enc(q)}/` },
  { marketplace: "John Lewis", domain: "johnlewis.com", emoji: "🛍️", regions: ["uk"], buildSearchUrl: (q) => `https://www.johnlewis.com/search?search-term=${enc(q)}` },
  { marketplace: "Currys", domain: "currys.co.uk", emoji: "🔌", regions: ["uk"], buildSearchUrl: (q) => `https://www.currys.co.uk/search?q=${enc(q)}` },
  { marketplace: "Marks & Spencer", domain: "marksandspencer.com", emoji: "🧥", regions: ["uk"], buildSearchUrl: (q) => `https://www.marksandspencer.com/search-results?q=${enc(q)}` },
  { marketplace: "Next", domain: "next.co.uk", emoji: "👗", regions: ["uk"], buildSearchUrl: (q) => `https://www.next.co.uk/search?w=${enc(q)}` },
  { marketplace: "Boots", domain: "boots.com", emoji: "💊", regions: ["uk"], buildSearchUrl: (q) => `https://www.boots.com/search?q=${enc(q)}` },
  { marketplace: "Very", domain: "very.co.uk", emoji: "🏷️", regions: ["uk"], buildSearchUrl: (q) => `https://www.very.co.uk/search/e/b/q/${enc(q)}.end` },

  // ── Singapore & Southeast Asia ────────────────────────────────────────────────
  { marketplace: "Shopee SG", domain: "shopee.sg", emoji: "🛍️", regions: ["sg", "my", "ph"], buildSearchUrl: (q) => `https://shopee.sg/search?keyword=${enc(q)}` },
  { marketplace: "Lazada SG", domain: "lazada.sg", emoji: "📦", regions: ["sg", "my", "ph"], buildSearchUrl: (q) => `https://www.lazada.sg/catalog/?q=${enc(q)}` },
  { marketplace: "Amazon SG", domain: "amazon.sg", emoji: "📦", regions: ["sg"], buildSearchUrl: (q) => `https://www.amazon.sg/s?k=${enc(q)}` },
  { marketplace: "Zalora", domain: "zalora.sg", emoji: "👗", regions: ["sg", "my", "ph"], buildSearchUrl: (q) => `https://www.zalora.sg/search/?q=${enc(q)}` },
  { marketplace: "Qoo10", domain: "qoo10.sg", emoji: "🛒", regions: ["sg"], buildSearchUrl: (q) => `https://www.qoo10.sg/search/${enc(q)}` },
  { marketplace: "Carousell", domain: "carousell.sg", emoji: "🔄", regions: ["sg", "my", "ph"], buildSearchUrl: (q) => `https://www.carousell.sg/search/${enc(q)}/` },

  // ── Malaysia ──────────────────────────────────────────────────────────────────
  { marketplace: "Shopee MY", domain: "shopee.com.my", emoji: "🛍️", regions: ["my"], buildSearchUrl: (q) => `https://shopee.com.my/search?keyword=${enc(q)}` },
  { marketplace: "Lazada MY", domain: "lazada.com.my", emoji: "📦", regions: ["my"], buildSearchUrl: (q) => `https://www.lazada.com.my/catalog/?q=${enc(q)}` },

  // ── Philippines ───────────────────────────────────────────────────────────────
  { marketplace: "Shopee PH", domain: "shopee.ph", emoji: "🛍️", regions: ["ph"], buildSearchUrl: (q) => `https://shopee.ph/search?keyword=${enc(q)}` },
  { marketplace: "Lazada PH", domain: "lazada.com.ph", emoji: "📦", regions: ["ph"], buildSearchUrl: (q) => `https://www.lazada.com.ph/catalog/?q=${enc(q)}` },

  // ── Australia ─────────────────────────────────────────────────────────────────
  { marketplace: "Amazon AU", domain: "amazon.com.au", emoji: "📦", regions: ["au"], buildSearchUrl: (q) => `https://www.amazon.com.au/s?k=${enc(q)}` },
  { marketplace: "JB Hi-Fi", domain: "jbhifi.com.au", emoji: "🔵", regions: ["au"], buildSearchUrl: (q) => `https://www.jbhifi.com.au/pages/search-page?query=${enc(q)}` },
  { marketplace: "Kogan", domain: "kogan.com", emoji: "🛒", regions: ["au"], buildSearchUrl: (q) => `https://www.kogan.com/au/shop/?q=${enc(q)}` },
  { marketplace: "Catch", domain: "catch.com.au", emoji: "🎣", regions: ["au"], buildSearchUrl: (q) => `https://www.catch.com.au/search/?q=${enc(q)}` },
  { marketplace: "Myer", domain: "myer.com.au", emoji: "🏬", regions: ["au"], buildSearchUrl: (q) => `https://www.myer.com.au/search?query=${enc(q)}` },
  { marketplace: "The Good Guys", domain: "thegoodguys.com.au", emoji: "📺", regions: ["au"], buildSearchUrl: (q) => `https://www.thegoodguys.com.au/SearchDisplay?searchTerm=${enc(q)}` },

  // ── India ─────────────────────────────────────────────────────────────────────
  { marketplace: "Amazon India", domain: "amazon.in", emoji: "📦", regions: ["in"], buildSearchUrl: (q) => `https://www.amazon.in/s?k=${enc(q)}` },
  { marketplace: "Flipkart", domain: "flipkart.com", emoji: "🛒", regions: ["in"], buildSearchUrl: (q) => `https://www.flipkart.com/search?q=${enc(q)}` },
  { marketplace: "Myntra", domain: "myntra.com", emoji: "👗", regions: ["in"], buildSearchUrl: (q) => `https://www.myntra.com/${enc(q)}` },
  { marketplace: "Meesho", domain: "meesho.com", emoji: "🏷️", regions: ["in"], buildSearchUrl: (q) => `https://www.meesho.com/search?q=${enc(q)}` },
  { marketplace: "Nykaa", domain: "nykaa.com", emoji: "💄", regions: ["in"], buildSearchUrl: (q) => `https://www.nykaa.com/search/result/?q=${enc(q)}` },

  // ── Canada ────────────────────────────────────────────────────────────────────
  { marketplace: "Amazon CA", domain: "amazon.ca", emoji: "📦", regions: ["ca"], buildSearchUrl: (q) => `https://www.amazon.ca/s?k=${enc(q)}` },
  { marketplace: "Best Buy CA", domain: "bestbuy.ca", emoji: "🔵", regions: ["ca"], buildSearchUrl: (q) => `https://www.bestbuy.ca/en-ca/search?query=${enc(q)}` },
  { marketplace: "Walmart CA", domain: "walmart.ca", emoji: "🏪", regions: ["ca"], buildSearchUrl: (q) => `https://www.walmart.ca/search?q=${enc(q)}` },
  { marketplace: "Canadian Tire", domain: "canadiantire.ca", emoji: "🍁", regions: ["ca"], buildSearchUrl: (q) => `https://www.canadiantire.ca/en/search-results.html?q=${enc(q)}` },

  // ── Germany / DACH ────────────────────────────────────────────────────────────
  { marketplace: "Amazon DE", domain: "amazon.de", emoji: "📦", regions: ["de", "at", "ch"], buildSearchUrl: (q) => `https://www.amazon.de/s?k=${enc(q)}` },
  { marketplace: "Otto", domain: "otto.de", emoji: "🛒", regions: ["de"], buildSearchUrl: (q) => `https://www.otto.de/suche/${enc(q)}` },
  { marketplace: "Zalando", domain: "zalando.de", emoji: "👟", regions: ["de", "at", "ch", "eu"], buildSearchUrl: (q) => `https://www.zalando.de/catalog/?q=${enc(q)}` },
  { marketplace: "MediaMarkt", domain: "mediamarkt.de", emoji: "📺", regions: ["de", "at"], buildSearchUrl: (q) => `https://www.mediamarkt.de/de/search.html?query=${enc(q)}` },
]

const TEMPLATE_MAP = new Map(MARKETPLACE_TEMPLATES.map((t) => [t.marketplace, t]))

// ── Region detection — inferred from the scanned domain, no user location needed ──
// We read the TLD and known brand domains to figure out what market the user is in.
function detectRegion(domain: string): string {
  const d = domain.toLowerCase().replace(/^www\./, "")

  // Explicit country TLDs
  if (d.endsWith(".sg") || d.includes("shopee.sg") || d.includes("lazada.sg") || d.includes("amazon.sg")) return "sg"
  if (d.endsWith(".com.my") || d.includes("shopee.com.my") || d.includes("lazada.com.my")) return "my"
  if (d.endsWith(".com.ph") || d.endsWith(".ph")) return "ph"
  if (d.endsWith(".com.au") || d.endsWith(".net.au") || d.includes("jbhifi") || d.includes("kogan.com") || d.includes("catch.com.au")) return "au"
  if (d.endsWith(".co.uk") || d.endsWith(".org.uk") || d.includes("argos.co.uk") || d.includes("johnlewis.com") || d.includes("currys.co.uk") || d.includes("boots.com") || d.includes("next.co.uk")) return "uk"
  if (d.endsWith(".in") || d.includes("flipkart.com") || d.includes("myntra.com") || d.includes("nykaa.com") || d.includes("meesho.com")) return "in"
  if (d.endsWith(".ca") || d.includes("canadiantire")) return "ca"
  if (d.endsWith(".de") || d.includes("otto.de") || d.includes("mediamarkt.de")) return "de"
  if (d.endsWith(".at")) return "at"
  if (d.endsWith(".ch")) return "ch"
  if (d.endsWith(".fr") || d.includes("fnac.com") || d.includes("darty.com")) return "fr"
  if (d.endsWith(".jp") || d.includes("rakuten.co.jp") || d.includes("yahoo.co.jp")) return "jp"

  // Default: treat as US/global
  return "us"
}

type CompetitorSelection = {
  competitor: Competitor
  score: number
  reasons: string[]
}

// ── GPT-4o marketplace selector ───────────────────────────────────────────────
// Region is inferred from the scanned domain — no user location collected.
// GPT-4o gets only regionally eligible candidates, so it never picks Best Buy
// for a Singapore user or Shopee for a US user.

async function selectCompetitorsSmart(
  query: string,
  currentDomain: string,
  onLog: (msg: string) => void
): Promise<CompetitorSelection[]> {
  const cleanDomain = currentDomain.replace(/^www\./, "")
  const region = detectRegion(cleanDomain)

  // Filter to regionally eligible stores, excluding the site being scanned
  const candidates = MARKETPLACE_TEMPLATES.filter((m) => {
    const eligible = m.regions.includes(region) || m.regions.includes("global")
    const notSelf = !cleanDomain.includes(m.domain) && !m.domain.includes(cleanDomain)
    return eligible && notSelf
  })

  if (!process.env.OPENAI_API_KEY || candidates.length === 0) {
    return candidates.slice(0, 4).map((m) => ({
      competitor: { marketplace: m.marketplace, domain: m.domain, emoji: m.emoji, searchUrl: m.buildSearchUrl(query) },
      score: 1,
      reasons: ["fallback selection"],
    }))
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    onLog(`AI selecting ${region.toUpperCase()} marketplaces to compare...`)

    const catalogueList = candidates
      .map((m) => `${m.marketplace} (${m.domain})`)
      .join(", ")

    const prompt = `You are a market research expert choosing comparison shopping sites.

User is scanning: ${cleanDomain}
Detected market/region: ${region.toUpperCase()}
Product query: "${query}"

Available marketplaces for this region (choose ONLY from this exact list):
${catalogueList}

Task: Pick exactly 4 marketplaces that a real shopper in the ${region.toUpperCase()} market would actually check for this product.

Rules:
- Only pick from the list above — these are already filtered to the right region
- Match the product category STRICTLY:
  • Electronics / tech / branded gadgets (AirPods, phones, laptops, cameras) → only pick tech/general retailers. NEVER Etsy, ThriftBooks, Boohoo, PrettyLittleThing, Zaful
  • Fashion / clothing → fashion retailers. NEVER Best Buy, Newegg, B&H
  • Beauty → beauty/health retailers
  • Handmade / vintage / custom gifts → ONLY then consider Etsy
  • Books → ONLY then consider ThriftBooks
- If a brand official store is relevant (e.g. AirPods → Apple Store, Nike shoes → Nike), include it
- Always include the dominant general marketplace for the region (e.g. Shopee/Lazada for SEA, Amazon for US/UK/AU)
- Prioritise where a real local shopper would actually buy this product
- When in doubt, prefer larger general marketplaces over niche ones

Return strict JSON only — no markdown:
{
  "selected": [
    { "marketplace": "exact name from list", "why": "1 sentence" }
  ]
}`

    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 400,
    })

    const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as {
      selected?: Array<{ marketplace?: string; why?: string }>
    }

    const selected: CompetitorSelection[] = []
    for (const pick of parsed.selected ?? []) {
      const name = pick.marketplace?.trim() ?? ""
      const template = TEMPLATE_MAP.get(name)
      if (!template) continue
      selected.push({
        competitor: {
          marketplace: template.marketplace,
          domain: template.domain,
          emoji: template.emoji,
          searchUrl: template.buildSearchUrl(query),
        },
        score: 10,
        reasons: [pick.why?.trim() ?? "AI-selected"],
      })
    }

    if (selected.length > 0) return selected.slice(0, 4)

    return candidates.slice(0, 4).map((m) => ({
      competitor: { marketplace: m.marketplace, domain: m.domain, emoji: m.emoji, searchUrl: m.buildSearchUrl(query) },
      score: 1,
      reasons: ["fallback selection"],
    }))
  } catch {
    onLog("Marketplace AI router unavailable — using regional defaults.")
    return candidates.slice(0, 4).map((m) => ({
      competitor: { marketplace: m.marketplace, domain: m.domain, emoji: m.emoji, searchUrl: m.buildSearchUrl(query) },
      score: 1,
      reasons: ["fallback selection"],
    }))
  }
}

export function pickCompetitors(
  query: string,
  currentDomain: string
): Competitor[] {
  const cleanDomain = currentDomain.replace(/^www\./, "")
  const region = detectRegion(cleanDomain)
  return MARKETPLACE_TEMPLATES
    .filter((m) => {
      const eligible = m.regions.includes(region) || m.regions.includes("global")
      const notSelf = !cleanDomain.includes(m.domain) && !m.domain.includes(cleanDomain)
      return eligible && notSelf
    })
    .slice(0, 4)
    .map((m) => ({
      marketplace: m.marketplace,
      domain: m.domain,
      emoji: m.emoji,
      searchUrl: m.buildSearchUrl(query),
    }))
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
        }): Array<{
          name: string
          price: string
          thumbnailUrl: string
          productPageUrl: string
        }> => {
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
            return []
          }

          // Return top 6 by score — GPT will pick the semantically correct one
          return candidates
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((c) => ({
              name: c.name.slice(0, 120),
              price: c.price,
              thumbnailUrl: c.thumbnailUrl,
              productPageUrl: c.productPageUrl,
            }))
        },
        { mp: marketplace, q: query }
      )

    // ── GPT-4o relevance picker ────────────────────────────────────────────────
    // Given multiple DOM candidates, ask GPT which one actually matches the
    // search intent — prevents accessories/variants being picked over the real item.
    const pickRelevantCandidate = async (
      candidates: Array<{ name: string; price: string; thumbnailUrl: string; productPageUrl: string }>
    ): Promise<{ name: string; price: string; thumbnailUrl: string; productPageUrl: string }> => {
      // Fast path: only 1 candidate
      if (candidates.length <= 1) return candidates[0] ?? { name: "", price: "", thumbnailUrl: "", productPageUrl: "" }

      // If any candidate has a price AND its name closely matches query, prefer it without GPT call
      // (saves latency on easy cases)
      const exactish = candidates.find((c) => {
        const nameLower = c.name.toLowerCase()
        const queryLower = query.toLowerCase()
        // All significant query words present in name
        const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2)
        return (
          normalizePrice(c.price) !== "" &&
          queryWords.every((w) => nameLower.includes(w))
        )
      })
      if (exactish) return exactish

      if (!process.env.OPENAI_API_KEY) {
        // No GPT — return first candidate with a price, else first overall
        return candidates.find((c) => normalizePrice(c.price) !== "") ?? candidates[0]
      }

      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        const list = candidates
          .map((c, i) => `${i + 1}. "${c.name}" — ${c.price || "no price"}`)
          .join("\n")
        const res = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: `A shopper searched for: "${query}"

These are search results found on ${marketplace}:
${list}

Which result number best matches what the shopper actually wants?

Rules (in order of priority):
1. Must be the correct product TYPE — if searching for headphones, reject ear tips, cases, chargers, cables, screen protectors, replacement parts, bundles, or anything that isn't the main device
2. Must be the correct BRAND — if searching for Apple AirPods, reject third-party "Pro" earbuds even if the name looks similar
3. Must be the correct GENERATION — if searching for "Pro 2", prefer Pro 2 over Pro 1 or Pro 3
4. Prefer results with a price over those without
5. If no result matches at all, reply "none"

Reply with ONLY the result number (e.g. "2") or "none". Nothing else.`,
            },
          ],
          max_tokens: 5,
          temperature: 0,
        })
        const answer = res.choices[0].message.content?.trim().toLowerCase() ?? "1"
        if (answer === "none") {
          // GPT says none of the results actually match — return empty
          return { name: "", price: "", thumbnailUrl: "", productPageUrl: "" }
        }
        const pick = parseInt(answer, 10)
        const chosen = candidates[(pick - 1)] ?? candidates[0]
        return chosen
      } catch {
        return candidates.find((c) => normalizePrice(c.price) !== "") ?? candidates[0]
      }
    }

    // ── Extract candidates, pick the right one, scroll for more if needed ─────
    let candidates = await extractOnce()

    // Scroll pass — collect more candidates if first batch had no priced items
    if (!candidates.some((c) => normalizePrice(c.price) !== "")) {
      for (let pass = 0; pass < 2; pass++) {
        await page.evaluate((n) => window.scrollBy({ top: n, behavior: "smooth" }), 700 + pass * 450)
        await page.waitForTimeout(850 + pass * 300)
        const more = await extractOnce()
        // Merge unique candidates by name
        for (const m of more) {
          if (m.name && !candidates.some((c) => c.name === m.name)) candidates.push(m)
        }
        if (candidates.some((c) => normalizePrice(c.price) !== "")) break
      }
    }

    let result = await pickRelevantCandidate(candidates)

    // If still no price, open the matched product page and try PDP extraction
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

    // Only consider a result "best value" if we know what product was found AND
    // the price isn't suspiciously far below the others (likely wrong product).
    const pricedWithName = priced.filter(
      (e) => e.product.name.trim().length > 0
    )

    // If we have named results, compute the median to filter outliers
    const namedPrices = pricedWithName.map((e) => e.numeric).sort((a, b) => a - b)
    const medianPrice = namedPrices.length > 0
      ? namedPrices[Math.floor(namedPrices.length / 2)]
      : null

    // Exclude any result priced more than 70% below the median — almost certainly a wrong/counterfeit product
    const credibleResults = medianPrice != null
      ? pricedWithName.filter((e) => e.numeric >= medianPrice * 0.3)
      : pricedWithName

    // No credible named results → no winner (don't award Best Value to unnamed or outlier prices)
    const winnerEntry = credibleResults.length > 0
      ? credibleResults.slice().sort((a, b) => a.numeric - b.numeric)[0]
      : undefined
    const winner = winnerEntry?.competitor.marketplace ?? ""
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

// ── Auto-retry merge helper ───────────────────────────────────────────────────
// After a slow-mode retry returns a real price, merge it back into the existing
// comparison object and recompute the winner + verdict labels.

export function mergeMarketplaceRetry(
  existing: MarketplaceComparison,
  updated: MarketplaceResult
): MarketplaceComparison {
  const results = existing.results.map((r) =>
    r.marketplace === updated.marketplace ? updated : r
  )

  // Recompute winner — same median-filter logic as compareMarketplaces
  const namedPriced = results
    .filter(
      (r) =>
        r.topResultName &&
        r.topResultName !== "Verification wall encountered" &&
        r.topResultName !== "Top result unavailable" &&
        r.priceRange !== "unknown" &&
        r.priceRange !== ""
    )
    .map((r) => ({ r, n: parsePriceNumber(r.priceRange) }))
    .filter((x): x is { r: MarketplaceResult; n: number } => x.n != null)

  const sortedPrices = namedPriced.map((x) => x.n).sort((a, b) => a - b)
  const median =
    sortedPrices.length > 0
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : null
  const credible =
    median != null
      ? namedPriced.filter((x) => x.n >= median * 0.3)
      : namedPriced
  credible.sort((a, b) => a.n - b.n)

  const winner =
    credible.length > 0 ? credible[0].r.marketplace : existing.winner
  const lowestN = credible[0]?.n ?? null

  // Re-stamp verdict labels based on new winner
  const finalResults = results.map((r) => {
    if (r.priceRange === "unknown" || !r.priceRange) return r
    const n = parsePriceNumber(r.priceRange)
    if (n == null) return r
    if (winner && r.marketplace === winner) {
      return {
        ...r,
        verdict: "best-value" as const,
        verdictReason: "Lowest live price among checked marketplaces.",
      }
    }
    if (lowestN != null) {
      const deltaPct = ((n - lowestN) / lowestN) * 100
      if (deltaPct > 20) {
        return {
          ...r,
          verdict: "premium" as const,
          verdictReason: `About ${Math.round(deltaPct)}% above lowest observed price.`,
        }
      }
      return {
        ...r,
        verdict: "comparable" as const,
        verdictReason: `Within ${Math.max(1, Math.round(Math.abs(deltaPct)))}% of lowest observed price.`,
      }
    }
    return r
  })

  const knownCount = finalResults.filter(
    (r) => r.priceRange && r.priceRange !== "unknown"
  ).length
  const blockedCount = finalResults.length - knownCount
  const summary =
    knownCount === 0
      ? "All marketplace checks were blocked or lacked visible prices."
      : `Observed ${knownCount}/${finalResults.length} live marketplace price${knownCount !== 1 ? "s" : ""}${blockedCount > 0 ? ` (${blockedCount} still blocked)` : ""}.`

  // Remove from recoveryPlans if now resolved
  const recoveryPlans = (existing.recoveryPlans ?? []).filter(
    (p) =>
      p.marketplace !== updated.marketplace ||
      updated.priceRange === "unknown" ||
      updated.priceRange === ""
  )

  return { ...existing, results: finalResults, winner, summary, recoveryPlans }
}

// ── Cookie consent auto-accept ─────────────────────────────────────────────────
// Many sites (especially EU/UK/AU) gate their content behind a consent banner.
// Click "Accept All" before trying to scrape prices.

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptSelectors = [
    // Generic
    'button[id*="accept"]', 'button[class*="accept"]',
    'button[id*="cookie"]', 'button[class*="cookie"]',
    // Text-based — works for most English sites
    'button:has-text("Accept all")', 'button:has-text("Accept All")',
    'button:has-text("Accept cookies")', 'button:has-text("Accept Cookies")',
    'button:has-text("Allow all")', 'button:has-text("Allow All")',
    'button:has-text("Agree")', 'button:has-text("I agree")',
    'button:has-text("Got it")', 'button:has-text("OK")',
    // Named patterns from common CMPs
    '#onetrust-accept-btn-handler',
    '.cc-accept', '.js-accept-cookies', '[data-testid="cookie-accept"]',
    '#cookiescript_accept', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '.gdpr-cookiewall__accept',
  ]
  for (const sel of acceptSelectors) {
    try {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 1000 })
        await page.waitForTimeout(600)
        return
      }
    } catch {
      // keep trying
    }
  }
}

// ── GPT-4o vision price extraction ─────────────────────────────────────────────
// Last resort: screenshot the page and let GPT-4o read the price visually.
// Only used when all DOM approaches fail.

async function extractPriceWithVision(
  page: Page,
  marketplace: string,
  query: string
): Promise<string> {
  try {
    const shot = await page.screenshot({ type: "jpeg", quality: 70, timeout: 4_000 })
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${shot.toString("base64")}`, detail: "low" } },
            {
              type: "text",
              text: `This is a ${marketplace} search results page for "${query}".
Find the price of the FIRST/top product result visible.
Reply with ONLY the price (e.g. "$29.99" or "£45.00"). If you cannot see any price at all, reply with the single word "none".`,
            },
          ],
        },
      ],
      max_tokens: 20,
      temperature: 0,
    })
    const raw = res.choices[0].message.content?.trim() ?? ""
    if (raw.toLowerCase() === "none" || !raw) return ""
    // Validate it looks like a price
    return /[$£€₹]\s*[\d]/.test(raw) ? raw : ""
  } catch {
    return ""
  }
}

export async function retryMarketplaceSlowMode(
  query: string,
  currentDomain: string,
  marketplace: string,
  onLog: (msg: string) => void,
  onScreenshot?: (dataUrl: string, label: string, streamId?: string) => void
): Promise<MarketplaceResult | null> {
  // Look up from full template map — GPT may have selected any store, not just the
  // first 4 returned by pickCompetitors. Fall back to pickCompetitors if not found.
  const template = TEMPLATE_MAP.get(marketplace)
  const target: Competitor | undefined = template
    ? { marketplace: template.marketplace, domain: template.domain, emoji: template.emoji, searchUrl: template.buildSearchUrl(query) }
    : pickCompetitors(query, currentDomain).find((c) => c.marketplace === marketplace)

  if (!target) {
    onLog(`Retry: marketplace "${marketplace}" not found in catalogue`)
    return null
  }

  const streamId = `market-${target.marketplace.toLowerCase().replace(/\s+/g, "-")}`
  const browser = await launchBrowser()

  try {
    onLog(`Retrying ${target.marketplace} — slow human mode + cookie handling...`)
    const page = await newPage(browser, true)

    try {
      // ── 1. Load the site homepage first — looks more human ──────────────────
      try {
        await page.goto(`https://${target.domain}`, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        })
        await page.waitForTimeout(800 + Math.floor(Math.random() * 600))
        // Accept any cookie banner on the homepage
        await dismissCookieBanner(page)
        await page.waitForTimeout(400)
      } catch {
        // homepage load failed — proceed directly to search
      }

      // ── 2. Navigate to search results ────────────────────────────────────────
      await page.goto(target.searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 35_000,
      })

      // Screenshot immediately after load
      const snapshot = async (label: string) => {
        try {
          const shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 2_500 })
          onScreenshot?.(`data:image/jpeg;base64,${shot.toString("base64")}`, `🧭 RETRY · ${target.marketplace}`, streamId)
        } catch { /* ignore */ }
      }
      await snapshot("loaded")

      // ── 3. Accept cookie banner on search page ───────────────────────────────
      await dismissCookieBanner(page)
      await page.waitForTimeout(500 + Math.floor(Math.random() * 400))

      // ── 4. Human-like scroll to trigger lazy-load ────────────────────────────
      await page.mouse.move(
        400 + Math.floor(Math.random() * 200),
        300 + Math.floor(Math.random() * 150),
        { steps: 20 }
      )
      await page.waitForTimeout(300)
      await page.evaluate(() => window.scrollBy({ top: 350, behavior: "smooth" }))
      await page.waitForTimeout(700 + Math.floor(Math.random() * 400))
      await page.evaluate(() => window.scrollBy({ top: 250, behavior: "smooth" }))
      await page.waitForTimeout(500)

      // ── 5. Wait for a price element to appear ────────────────────────────────
      const priceSelectors = [
        '[class*="price"]', '[data-testid*="price"]', '[itemprop="price"]',
        '[class*="Price"]', '[id*="price"]', '.a-price', '.price-box',
      ]
      for (const sel of priceSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 4_000 })
          break
        } catch { /* try next */ }
      }

      await snapshot("after-scroll")

      // ── 6. Run DOM extraction (same as fast path but on a warmed-up page) ────
      const product = await extractFromPage(page, target.marketplace, target.searchUrl, query, { slowMode: true })

      // ── 7. If DOM extraction still has no price, try GPT-4o vision ───────────
      if (normalizePrice(product.price) === "" && !product.blockedByVerification) {
        onLog(`  ↳ DOM had no price — trying GPT-4o vision on ${target.marketplace}...`)
        const visionPrice = await extractPriceWithVision(page, target.marketplace, query)
        if (visionPrice) {
          onLog(`  ↳ Vision extracted: ${visionPrice}`)
          product.price = visionPrice
        }
      }

      await snapshot("final")

      const price = normalizePrice(product.price)
      const verdictReason = price !== ""
        ? "Live price captured on slow-mode retry."
        : product.blockedByVerification
          ? "Still blocked by human verification after retry."
          : "Retry completed — no clear price visible on page."

      onLog(`  ↳ ${target.marketplace} retry result: ${price || "no price"}`)

      return mapExtractedToResult(target, product, "comparable", verdictReason)
    } finally {
      await page.context().close().catch(() => { /* ignore */ })
    }
  } finally {
    await browser.close()
  }
}
