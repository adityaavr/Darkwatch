import type { Browser, Page } from "playwright-core"
import type { WholesaleBenchmark, WholesaleBenchmarkResult } from "./types"
import { launchPlaywrightBrowser } from "./playwright-launch"

type SourceConfig = {
  source: "AliExpress" | "Alibaba"
  searchUrl: (query: string) => string
}

const SOURCES: SourceConfig[] = [
  {
    source: "AliExpress",
    searchUrl: (query) =>
      `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`,
  },
  {
    source: "Alibaba",
    searchUrl: (query) =>
      `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}`,
  },
]

function parsePriceValue(raw: string): number | null {
  const match = raw.match(/\d+(?:[.,]\d{1,2})?/)
  if (!match) return null
  const value = Number.parseFloat(match[0].replace(",", "."))
  return Number.isFinite(value) ? value : null
}

function parseRetailPrice(raw: string): number | null {
  const match = raw.match(/\d+[\d,]*(?:\.\d{1,2})?/)?.[0]
  if (!match) return null
  const value = Number.parseFloat(match.replace(/,/g, ""))
  return Number.isFinite(value) ? value : null
}

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

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    })
    // @ts-ignore
    window.chrome = {
      runtime: {},
      loadTimes: () => ({}),
      csi: () => ({}),
      app: {},
    }
  })
  return context.newPage()
}

async function extractTopWholesaleResult(
  page: Page,
  source: "AliExpress" | "Alibaba",
  searchUrl: string
): Promise<WholesaleBenchmarkResult | null> {
  try {
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    })
    await page.waitForTimeout(1800)

    const data = await page.evaluate(
      (src): { title: string; price: string; url: string } => {
        if (src === "AliExpress") {
          const cards = document.querySelectorAll(
            '[class*="search-item"], [class*="list-item"], [class*="manhattan--container"]'
          )
          for (const card of cards) {
            const titleEl = card.querySelector('h3, h2, [class*="title"]')
            const priceEl = card.querySelector(
              '[class*="price"], [class*="Price"]'
            )
            const linkEl = card.querySelector(
              'a[href*="/item/"]'
            ) as HTMLAnchorElement | null

            const title = titleEl?.textContent?.trim() ?? ""
            const price = priceEl?.textContent?.trim() ?? ""
            const url = linkEl?.href ?? ""
            if (title && price)
              return {
                title: title.slice(0, 120),
                price: price.replace(/\s+/g, " ").slice(0, 30),
                url,
              }
          }
        }

        const cards = document.querySelectorAll(
          '[class*="organic-offer"], [class*="J-offer-wrapper"], [class*="search-card"]'
        )
        for (const card of cards) {
          const titleEl = card.querySelector('h2, h3, [class*="title"]')
          const priceEl = card.querySelector(
            '[class*="price"], [class*="Price"]'
          )
          const linkEl = card.querySelector(
            'a[href*="product-detail"], a[href*="/product/"]'
          ) as HTMLAnchorElement | null

          const title = titleEl?.textContent?.trim() ?? ""
          const price = priceEl?.textContent?.trim() ?? ""
          const url = linkEl?.href ?? ""
          if (title && price)
            return {
              title: title.slice(0, 120),
              price: price.replace(/\s+/g, " ").slice(0, 30),
              url,
            }
        }

        return { title: "", price: "", url: "" }
      },
      source
    )

    if (!data.title || !data.price) return null
    return {
      source,
      productTitle: data.title,
      price: data.price,
      productUrl: data.url || searchUrl,
    }
  } catch {
    return null
  }
}

export async function compareWholesaleBenchmarks(
  query: string,
  retailPriceRaw: string,
  onLog: (msg: string) => void
): Promise<WholesaleBenchmark | null> {
  const retailValue = parseRetailPrice(retailPriceRaw)
  onLog("Cross-checking wholesale benchmarks (AliExpress + Alibaba)...")

  const browser = await launchBrowser()
  try {
    const page = await newPage(browser)
    const results: WholesaleBenchmarkResult[] = []

    for (const source of SOURCES) {
      const searchUrl = source.searchUrl(query)
      onLog(`  ↳ ${source.source} benchmark...`)
      const top = await extractTopWholesaleResult(
        page,
        source.source,
        searchUrl
      )
      if (top) results.push(top)
    }

    if (results.length === 0) {
      onLog("Wholesale benchmark unavailable for this query")
      return null
    }

    const wholesaleValues = results
      .map((r) => parsePriceValue(r.price))
      .filter((v): v is number => v != null)

    if (wholesaleValues.length === 0) {
      return {
        benchmarks: results,
        estimatedWholesalePrice: "unknown",
        summary: "Wholesale listings found, but no reliable price extracted.",
      }
    }

    const cheapest = Math.min(...wholesaleValues)
    const estimatedWholesalePrice = `$${cheapest.toFixed(2)}`

    if (!retailValue || retailValue <= 0) {
      return {
        benchmarks: results,
        estimatedWholesalePrice,
        summary: `Cheapest wholesale benchmark around ${estimatedWholesalePrice}.`,
      }
    }

    const markupPct = Math.max(0, ((retailValue - cheapest) / cheapest) * 100)
    const estimatedMarkupPercentage = `${Math.round(markupPct)}%`
    onLog(
      `Wholesale benchmark: ~${estimatedMarkupPercentage} markup vs ${estimatedWholesalePrice}`
    )

    return {
      benchmarks: results,
      estimatedWholesalePrice,
      estimatedMarkupPercentage,
      summary: `Cheapest wholesale source is ${estimatedWholesalePrice}; retail is about ${estimatedMarkupPercentage} higher.`,
    }
  } finally {
    await browser.close()
  }
}
