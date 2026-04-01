/**
 * playwright-service.ts
 *
 * Replaces TinyFish for all interactive browser sessions:
 *   - runPlaywrightScan      → navigate product page, extract data, add to cart, detect fees
 *   - getVisualDarkPatterns  → DOM + vision-based screenshot evidence
 *   - getRedditSentiment     → Reddit search + comment extraction
 *
 * Uses playwright-extra + stealth plugin to avoid bot detection.
 * Plain HTTP (fetchPagePlain) is still used for static pages (trust sites, policy pages).
 */

import type { Page, Browser } from "playwright-core"
import OpenAI from "openai"
import type { JunkFee, VisualDarkPatterns } from "./types"
import { launchPlaywrightBrowser } from "./playwright-launch"

type LogLevel = "info" | "warn" | "action" | "vision" | "success"

export type PlaywrightScanResult = {
  productImageUrl: string | null
  listedPrice: string | null
  cartFees: JunkFee[]
  cartTotal: string | null
  cartDrawerReached: boolean
  evidenceScreenshots: string[] // full data: URIs
  pageText: string
}

type SitePlan = {
  productUrl: string
  isHomepage: boolean
  cartButtonLabel: string
  knownFees: string[]
  requiresLoginForCart: boolean
}

// ── Rotating realistic UAs (Chrome 124-125 on Mac/Win) ────────────────────────

const STEALTH_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.207 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
]
function pickUA() {
  return STEALTH_UAS[Math.floor(Math.random() * STEALTH_UAS.length)]
}

// ── Browser factory ────────────────────────────────────────────────────────────

async function launchBrowser(): Promise<Browser> {
  return launchPlaywrightBrowser({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--window-size=1440,900",
      "--hide-scrollbars",
      "--mute-audio",
      "--lang=en-US,en",
      "--accept-lang=en-US,en;q=0.9",
    ],
  })
}

async function newStealthPage(browser: Browser): Promise<Page> {
  const ua = pickUA()
  // Vary viewport slightly so each session looks different
  const width = 1280 + Math.floor(Math.random() * 200)
  const height = 800 + Math.floor(Math.random() * 120)

  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width, height },
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "light",
    // Plausible screen/device metrics
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "sec-ch-ua":
        '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  })

  // ── Comprehensive anti-detection init script ───────────────────────────────
  await context.addInitScript(() => {
    // 1. Remove webdriver flag — #1 detection signal
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })

    // 2. Fake a realistic plugin list (PDF viewer, etc.)
    const fakePlugins = [
      {
        name: "PDF Viewer",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
        length: 1,
      },
      {
        name: "Chrome PDF Viewer",
        filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
        description: "",
        length: 1,
      },
      {
        name: "Chromium PDF Plugin",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
        length: 1,
      },
      {
        name: "Microsoft Edge PDF Viewer",
        filename: "edge-pdf-viewer",
        description: "",
        length: 1,
      },
      {
        name: "WebKit built-in PDF",
        filename: "webkit-pdf-viewer",
        description: "",
        length: 1,
      },
    ]
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const arr = fakePlugins as unknown as Plugin[]
        Object.defineProperty(arr, "length", { value: fakePlugins.length })
        Object.setPrototypeOf(arr, PluginArray.prototype)
        return arr
      },
    })

    // 3. Languages — first must match Accept-Language header
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    })

    // 4. Hardware signals — look like a real machine
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 })
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 })
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 })

    // 5. Chrome runtime — headless is missing window.chrome entirely
    // @ts-ignore
    window.chrome = {
      app: {
        isInstalled: false,
        InstallState: {
          DISABLED: "disabled",
          INSTALLED: "installed",
          NOT_INSTALLED: "not_installed",
        },
        RunningState: {
          CANNOT_RUN: "cannot_run",
          READY_TO_RUN: "ready_to_run",
          RUNNING: "running",
        },
      },
      runtime: {
        OnInstalledReason: {
          CHROME_UPDATE: "chrome_update",
          INSTALL: "install",
          SHARED_MODULE_UPDATE: "shared_module_update",
          UPDATE: "update",
        },
        OnRestartRequiredReason: {
          APP_UPDATE: "app_update",
          GC: "gc",
          OS_UPDATE: "os_update",
        },
        PlatformArch: {
          ARM: "arm",
          ARM64: "arm64",
          MIPS: "mips",
          MIPS64: "mips64",
          X86_32: "x86-32",
          X86_64: "x86-64",
        },
        PlatformOs: {
          ANDROID: "android",
          CROS: "cros",
          LINUX: "linux",
          MAC: "mac",
          OPENBSD: "openbsd",
          WIN: "win",
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: "no_update",
          THROTTLED: "throttled",
          UPDATE_AVAILABLE: "update_available",
        },
        id: undefined,
      },
      loadTimes: () => ({}),
      csi: () => ({}),
    }

    // 6. Permissions API — headless returns 'denied' for notifications by default
    const origQuery = navigator.permissions.query.bind(navigator.permissions)
    // @ts-ignore
    navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
            onchange: null,
          } as PermissionStatus)
        : origQuery(parameters)

    // 7. WebGL — spoof vendor/renderer so fingerprint doesn't look like SwiftShader
    const getParameter = WebGLRenderingContext.prototype.getParameter
    WebGLRenderingContext.prototype.getParameter = function (
      parameter: number
    ) {
      if (parameter === 37445) return "Intel Inc." // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return "Intel Iris OpenGL Engine" // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, parameter)
    }

    // 8. Hide automation-specific properties
    // @ts-ignore
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array
    // @ts-ignore
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise
    // @ts-ignore
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol

    // 9. Screen dimensions — make them match viewport
    Object.defineProperty(screen, "availWidth", {
      get: () => window.innerWidth,
    })
    Object.defineProperty(screen, "availHeight", {
      get: () => window.innerHeight,
    })
  })

  const page = await context.newPage()

  // 10. Intercept and block known bot-detection fingerprinting endpoints
  await page.route("**/*", async (route) => {
    const url = route.request().url()
    // Block DataDome, PerimeterX, Imperva detection scripts
    if (
      /datadome\.co|perimeterx\.net|px-cdn\.net|px\.ads\.linkedin|imperva\.com|kasada\.io|recaptcha.*enterprise/.test(
        url
      )
    ) {
      await route.abort()
      return
    }
    await route.continue()
  })

  return page
}

// ── Human-like behaviour helpers ──────────────────────────────────────────────
// Randomised delays and micro-mouse-moves make traffic look less robotic.

function jitter(base: number, range = 0.4): number {
  return base + Math.floor((Math.random() - 0.5) * base * range)
}

async function humanPause(page: Page, ms = 800): Promise<void> {
  await page.waitForTimeout(jitter(ms))
}

async function humanScroll(page: Page): Promise<void> {
  // Scroll down a little (as a real user would) then back slightly
  await page.evaluate(() => {
    window.scrollBy({
      top: Math.floor(Math.random() * 300 + 100),
      behavior: "smooth",
    })
  })
  await page.waitForTimeout(jitter(600))
}

async function humanClick(page: Page, selector: string): Promise<boolean> {
  try {
    const el = page.locator(selector).first()
    if (!(await el.isVisible({ timeout: 2000 }))) return false
    // Move mouse to element with slight random offset, pause, then click
    const box = await el.boundingBox()
    if (box) {
      const x = box.x + box.width * (0.3 + Math.random() * 0.4)
      const y = box.y + box.height * (0.3 + Math.random() * 0.4)
      await page.mouse.move(
        x + Math.random() * 10 - 5,
        y + Math.random() * 10 - 5
      )
      await page.waitForTimeout(jitter(150, 0.8))
      await page.mouse.click(x, y)
    } else {
      await el.click()
    }
    return true
  } catch {
    return false
  }
}

// ── Overlay dismissal ──────────────────────────────────────────────────────────

async function dismissOverlays(page: Page): Promise<void> {
  const TEXTS = [
    "Accept All",
    "Accept all cookies",
    "Accept Cookies",
    "Accept",
    "I Accept",
    "Agree",
    "I Agree",
    "Got it",
    "OK",
    "Allow all",
    "Continue",
    "Close",
    "No thanks",
    "Dismiss",
    "Continue shopping",
    "I understand",
  ]
  for (const text of TEXTS) {
    try {
      const btn = page
        .getByRole("button", { name: new RegExp(`^${text}$`, "i") })
        .first()
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click()
        await page.waitForTimeout(500)
        break
      }
    } catch {
      /* next */
    }
  }

  const CSS = [
    "#onetrust-accept-btn-handler",
    ".fc-cta-consent",
    ".cc-btn.cc-allow",
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[data-testid="close-button"]',
    '[data-testid="modal-close"]',
    ".modal__close",
    ".popup__close",
    ".dialog__close",
    '[class*="close-icon"]',
    '[class*="CloseButton"]',
  ]
  for (const sel of CSS) {
    try {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 200 })) {
        await el.click()
        await page.waitForTimeout(300)
      }
    } catch {
      /* next */
    }
  }
}

// ── Navigation helpers ─────────────────────────────────────────────────────────

async function clickFirstProduct(
  page: Page,
  onLog: (msg: string, level: LogLevel) => void
): Promise<boolean> {
  // First: read what results are visible on the search page
  const searchSummary = await page.evaluate((): string => {
    const headings = [
      ...document.querySelectorAll(
        'h2, h3, [class*="title"], [class*="product-name"]'
      ),
    ]
      .map((el) => el.textContent?.trim())
      .filter((t): t is string => !!t && t.length > 4 && t.length < 100)
      .slice(0, 3)
    const prices = [
      ...document.querySelectorAll(
        '[class*="price"], [class*="Price"], [itemprop="price"]'
      ),
    ]
      .map((el) => el.textContent?.trim())
      .filter((t): t is string => !!t && /[$£€¥]/.test(t))
      .slice(0, 3)
    if (headings.length > 0)
      return `${headings[0]}${prices[0] ? ` — ${prices[0]}` : ""}`
    return ""
  })
  if (searchSummary)
    onLog(`Search results loaded — top result: "${searchSummary}"`, "vision")

  const SELECTORS = [
    '[data-component-type="s-search-result"] h2 a',
    '[class*="product-list"] [class*="product-card"] a',
    '[class*="search-product-list"] a[href]',
    '[class*="product-card"] a[href]',
    '[class*="product-item"] a[href]',
    '[class*="product-tile"] a[href]',
    '[class*="goods-item"] a[href]',
    '[class*="item-card"] a[href]',
    ".s-item__link",
    "[data-item-id] a[href]",
    'a[href*="/product/"]',
    'a[href*="/item/"]',
    'a[href*="/p/"]',
    "article a[href]",
  ]

  for (const sel of SELECTORS) {
    try {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 700 })) {
        // Read the product name before clicking
        const productName = (await el.textContent().catch(() => "")) ?? ""
        const label = productName.trim().slice(0, 70) || "first result"
        onLog(`Clicking into "${label}"...`, "action")
        // Hover briefly before clicking (human behaviour)
        const box = await el.boundingBox()
        if (box) {
          await page.mouse.move(
            box.x + box.width * 0.5 + (Math.random() * 8 - 4),
            box.y + box.height * 0.5 + (Math.random() * 4 - 2)
          )
          await page.waitForTimeout(jitter(200, 0.6))
        }
        await el.click()
        await page.waitForLoadState("domcontentloaded", { timeout: 20_000 })
        await humanPause(page, 2000)
        await humanScroll(page)
        await dismissOverlays(page)
        // Read the product page title to confirm we landed correctly
        const pageTitle = await page.evaluate((): string => {
          const h1 = document.querySelector("h1")?.textContent?.trim() ?? ""
          return h1.slice(0, 80)
        })
        if (pageTitle) onLog(`Landed on product page: "${pageTitle}"`, "vision")
        return true
      }
    } catch {
      /* try next */
    }
  }
  onLog(
    "Could not find a product listing — will analyse the search page instead",
    "warn"
  )
  return false
}

async function selectFirstVariant(
  page: Page,
  onLog: (msg: string, level: LogLevel) => void
): Promise<void> {
  const VARIANT_SELECTORS = [
    'button[class*="size"]:not([disabled]):not([class*="disabled"]):not([class*="unavailable"]):not([class*="sold"])',
    'li[class*="size"]:not([class*="disabled"]) button:not([disabled])',
    '[class*="size-item"]:not([class*="disabled"]):not([class*="sold-out"])',
    '[class*="color-item"]:not([class*="disabled"])',
    '[class*="swatch"]:not([disabled]):not([class*="disabled"])',
    '[data-option-type="size"]:not([disabled])',
  ]

  for (const sel of VARIANT_SELECTORS) {
    try {
      const count = await page.locator(sel).count()
      if (count > 0) {
        const variantLabel =
          (await page
            .locator(sel)
            .first()
            .textContent()
            .catch(() => "")) ?? ""
        const label = variantLabel.trim().slice(0, 30)
        if (label) onLog(`Selecting variant: "${label}"`, "action")
        await page.locator(sel).first().click({ timeout: 1500 })
        await page.waitForTimeout(600)
        return // only need to select one variant
      }
    } catch {
      /* next */
    }
  }
}

// ── DOM data extraction ────────────────────────────────────────────────────────

async function extractPageData(page: Page): Promise<{
  productImageUrl: string | null
  price: string | null
  text: string
}> {
  return page.evaluate(
    (): {
      productImageUrl: string | null
      price: string | null
      text: string
    } => {
      // ── Product image (priority-ordered) ──
      const IMG_SELECTORS = [
        "#landingImage", // Amazon
        "#imgTagWrapperId img",
        "img[data-main-image]",
        'img[class*="main-image"]',
        'img[class*="hero-image"]',
        ".pdp-image img",
        ".product-gallery img",
        ".product-photo img",
        '[class*="gallery__image"] img',
        '[class*="ImageGallery"] img',
        'img[class*="product-image"]:not([class*="thumbnail"]):not([class*="thumb"])',
        '[class*="slide"] img[src*="product"]',
      ]
      let productImageUrl: string | null = null
      for (const sel of IMG_SELECTORS) {
        const el = document.querySelector(sel) as HTMLImageElement | null
        const src =
          el?.src || el?.dataset.src || el?.getAttribute("data-lazy-src") || ""
        if (
          src.startsWith("http") &&
          !src.includes("logo") &&
          !src.includes("icon") &&
          !src.includes("sprite")
        ) {
          productImageUrl = src
          break
        }
      }
      // Fallback: og:image
      if (!productImageUrl) {
        const og = document.querySelector(
          'meta[property="og:image"]'
        ) as HTMLMetaElement | null
        if (og?.content?.startsWith("http")) productImageUrl = og.content
      }

      // ── Price ──
      const PRICE_SELECTORS = [
        ".a-price-whole",
        ".a-offscreen", // Amazon
        '[class*="sale-price"]',
        '[class*="current-price"]',
        '[class*="price-sale"]',
        '[class*="price-current"]',
        '[itemprop="price"]',
        '[class*="product-price"]:not([class*="original"])',
        '[data-testid*="price"]',
        '[class*="Price"]:not([class*="Original"]):not([class*="Was"])',
      ]
      let price: string | null = null
      for (const sel of PRICE_SELECTORS) {
        const el = document.querySelector(sel)
        const t = el?.textContent?.trim()
        if (
          t &&
          (/[$£€¥₩]/.test(t) || /\d+[.,]\d{2}/.test(t)) &&
          t.length < 30
        ) {
          price = t.replace(/\s+/g, " ").trim()
          break
        }
      }

      return {
        productImageUrl,
        price,
        text: document.body.innerText.slice(0, 8000),
      }
    }
  )
}

// ── Add to cart + cart analysis ────────────────────────────────────────────────

async function addToCartAndScan(
  page: Page,
  plan: SitePlan,
  onLog: (msg: string, level: LogLevel) => void
): Promise<{
  cartFees: JunkFee[]
  cartTotal: string | null
  reached: boolean
  screenshot: string | null
}> {
  try {
    // Select variant (size/color) before clicking ATC
    await selectFirstVariant(page, onLog)
    await page.waitForTimeout(700)

    // Try to click Add to Cart — test multiple label variants
    let clicked = false
    let foundLabel = ""
    const LABELS = [
      plan.cartButtonLabel,
      "Add to Cart",
      "Add to Bag",
      "Add to Basket",
      "+ Cart",
      "Add",
      "Buy",
    ]
    for (const label of LABELS) {
      try {
        const btn = page
          .getByRole("button", { name: new RegExp(label, "i") })
          .first()
        if (await btn.isVisible({ timeout: 2000 })) {
          foundLabel = ((await btn.textContent().catch(() => "")) ?? label)
            .trim()
            .slice(0, 40)
          onLog(`Found "${foundLabel}" button — moving to click...`, "action")
          // Human-like: move mouse to button, pause, then click
          const box = await btn.boundingBox()
          if (box) {
            await page.mouse.move(
              box.x + box.width * (0.35 + Math.random() * 0.3),
              box.y + box.height * (0.3 + Math.random() * 0.4)
            )
            await page.waitForTimeout(jitter(180, 0.7))
          }
          await btn.click()
          clicked = true
          break
        }
      } catch {
        /* next label */
      }
    }

    if (!clicked) {
      onLog(
        'No "Add to Cart" button found — site may require login or item is out of stock',
        "warn"
      )
      return { cartFees: [], cartTotal: null, reached: false, screenshot: null }
    }

    onLog("Waiting for cart to open...", "action")

    // Wait for cart drawer / mini-cart to appear
    const CART_SELECTORS = [
      '[class*="cart-drawer"]',
      '[class*="CartDrawer"]',
      '[class*="mini-cart"]',
      '[class*="MiniCart"]',
      '[class*="cart-sidebar"]',
      '[class*="cart-flyout"]',
      '[id*="cart-drawer"]',
      '[id*="mini-cart"]',
      '[data-testid*="cart"]',
      "#cart-notification-product",
      ".CartDrawer",
      ".MiniCart",
      '[aria-label*="cart" i]',
    ]
    let reached = false
    for (const sel of CART_SELECTORS) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 })
        reached = true
        break
      } catch {
        /* next */
      }
    }

    await page.waitForTimeout(1500)

    const screenshot = (await page.screenshot()).toString("base64")

    // Read cart contents and describe what we see before sending to GPT-4o
    const cartSummary = await page.evaluate((): string => {
      const lines = document.body.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 1 && l.length < 120)
      // Look for lines containing price-like patterns or fee keywords
      const feeLikes = lines
        .filter((l) =>
          /[$£€][\d.,]+|shipping|protection|insurance|delivery|fee|charge|surcharge|add-on|subscription/i.test(
            l
          )
        )
        .slice(0, 8)
      return feeLikes.join(" · ")
    })
    const cartText = await page.evaluate(() =>
      document.body.innerText.slice(0, 7000)
    )

    if (reached) {
      onLog(
        `Cart opened${cartSummary ? ` — I can see: ${cartSummary}` : " — scanning for hidden fees..."}`,
        "vision"
      )
    } else {
      onLog(
        `Cart not detected as a drawer — scanning full page for fees...`,
        "vision"
      )
    }

    const fees = await extractFeesWithGPT(cartText, plan)
    return { ...fees, reached, screenshot }
  } catch (err) {
    onLog(
      `Cart error: ${err instanceof Error ? err.message : "unknown"}`,
      "warn"
    )
    return { cartFees: [], cartTotal: null, reached: false, screenshot: null }
  }
}

// ── GPT-4o fee extraction from cart text ──────────────────────────────────────

async function extractFeesWithGPT(
  cartText: string,
  plan: SitePlan
): Promise<{ cartFees: JunkFee[]; cartTotal: string | null }> {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `You are a hidden-fee detector. Analyse this e-commerce cart page text. Identify ALL fees, pre-checked add-ons, subscriptions, service charges, or junk charges that appear in addition to the base product price.
${plan.knownFees.length > 0 ? `\nKnown patterns on this site: ${plan.knownFees.join(", ")}\n` : ""}
PAGE TEXT:
${cartText}

Return ONLY valid JSON — empty cartFees array if nothing deceptive found:
{
  "cartFees": [{ "name": "exact name as shown on page", "amount": "exact amount shown", "description": "why this is deceptive or hidden" }],
  "cartTotal": "the final total shown, or null"
}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
    })
    const parsed = JSON.parse(res.choices[0].message.content!) as {
      cartFees?: JunkFee[]
      cartTotal?: string | null
    }
    return {
      cartFees: parsed.cartFees ?? [],
      cartTotal: parsed.cartTotal ?? null,
    }
  } catch {
    return { cartFees: [], cartTotal: null }
  }
}

// ── Main: full product scan ────────────────────────────────────────────────────

export async function runPlaywrightScan(
  plan: SitePlan,
  query: string,
  onLog: (msg: string, level: LogLevel) => void,
  onScreenshot?: (dataUrl: string) => void
): Promise<PlaywrightScanResult> {
  onLog("Starting browser session...", "action")
  // 20s connection timeout — if Browserless/local Chrome doesn't connect, fail fast
  const browser = await Promise.race([
    launchBrowser(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Browser connection timed out after 20s")), 20_000)
    ),
  ])
  onLog("Browser session connected.", "success")
  let screenshotInterval: ReturnType<typeof setInterval> | null = null

  try {
    const page = await newStealthPage(browser)
    const evidenceScreenshots: string[] = []

    // ── Live screenshot stream — sends a JPEG frame every 1.5s while running ──
    if (onScreenshot) {
      screenshotInterval = setInterval(async () => {
        try {
          const buf = await page.screenshot({
            type: "jpeg",
            quality: 55,
            timeout: 2000,
          })
          onScreenshot(`data:image/jpeg;base64,${buf.toString("base64")}`)
        } catch {
          /* page navigating — skip this frame */
        }
      }, 1500)

      try {
        const first = await page.screenshot({
          type: "jpeg",
          quality: 55,
          timeout: 2000,
        })
        onScreenshot(`data:image/jpeg;base64,${first.toString("base64")}`)
      } catch {
        // ignore early frame failures while page initializes
      }
    }

    // ── Navigate ──
    const host = new URL(plan.productUrl).hostname
    const path = new URL(plan.productUrl).pathname
    onLog(
      `Opening ${host}${path.length > 1 ? path.slice(0, 40) : ""}...`,
      "action"
    )
    try {
      await page.goto(plan.productUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      })
    } catch {
      await page.goto(plan.productUrl, { waitUntil: "commit", timeout: 15_000 })
    }
    await humanPause(page, 2500)

    // Behave like a real visitor — scroll a little before interacting
    await humanScroll(page)
    await humanPause(page, 400)

    // Dismiss any cookie/overlay banners — note them if found
    const hadOverlay = await page.evaluate((): boolean => {
      return !!document.querySelector(
        '[id*="cookie"],[class*="cookie"],[id*="consent"],[class*="gdpr"],[id*="popup"],[class*="modal"]'
      )
    })
    if (hadOverlay)
      onLog("Cookie/popup banner detected — dismissing...", "action")
    await dismissOverlays(page)
    await humanPause(page, 500)

    // ── If on search/homepage, find and click a product ──
    if (plan.isHomepage) {
      await clickFirstProduct(page, onLog)
    }

    // ── Read product page data ──
    onLog("Reading product page signals...", "vision")
    const pageData = await extractPageData(page)

    // Describe what we see on the product page
    const pageDescription = await page.evaluate(
      (): { title: string; reviewCount: string; rating: string } => {
        const title =
          document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? ""
        const rating =
          document
            .querySelector(
              '[class*="rating"],[itemprop="ratingValue"],[class*="stars"]'
            )
            ?.textContent?.trim()
            .slice(0, 20) ?? ""
        const reviewCount =
          document
            .querySelector(
              '[class*="review-count"],[itemprop="reviewCount"],[class*="reviews-count"]'
            )
            ?.textContent?.trim()
            .slice(0, 30) ?? ""
        return { title, rating, reviewCount }
      }
    )

    if (pageDescription.title) {
      const extras = [
        pageData.price && `listed at ${pageData.price}`,
        pageDescription.rating && `rated ${pageDescription.rating}`,
        pageDescription.reviewCount && `${pageDescription.reviewCount} reviews`,
      ]
        .filter(Boolean)
        .join(", ")
      onLog(
        `Product: "${pageDescription.title}"${extras ? ` (${extras})` : ""}`,
        "vision"
      )
    } else if (pageData.price) {
      onLog(`Listed price: ${pageData.price}`, "vision")
    }

    const productShot = (await page.screenshot()).toString("base64")
    evidenceScreenshots.push(`data:image/png;base64,${productShot}`)

    // ── Cart scan ──
    let cartFees: JunkFee[] = []
    let cartTotal: string | null = null
    let cartDrawerReached = false

    if (!plan.requiresLoginForCart) {
      const cart = await addToCartAndScan(page, plan, onLog)
      cartFees = cart.cartFees
      cartTotal = cart.cartTotal
      cartDrawerReached = cart.reached

      if (cart.screenshot) {
        const cartDataUrl = `data:image/png;base64,${cart.screenshot}`
        evidenceScreenshots.push(cartDataUrl)
        if (cartFees.length > 0) {
          cartFees = cartFees.map((f) => ({
            ...f,
            evidenceScreenshot: cartDataUrl,
          }))
        }
      }

      if (cartFees.length > 0) {
        const feeNames = cartFees
          .map((f) => `"${f.name}" (${f.amount})`)
          .join(", ")
        onLog(`⚠ ${cartFees.length} hidden fee(s) found: ${feeNames}`, "warn")
      } else {
        onLog(
          cartDrawerReached
            ? "Cart open — no hidden fees detected"
            : "Cart check complete — no fees found",
          "success"
        )
      }
    } else {
      onLog(
        "Cart scan skipped — this site requires login before checkout",
        "info"
      )
    }

    return {
      productImageUrl: pageData.productImageUrl,
      listedPrice: pageData.price,
      cartFees,
      cartTotal,
      cartDrawerReached,
      evidenceScreenshots,
      pageText: pageData.text,
    }
  } finally {
    if (screenshotInterval) clearInterval(screenshotInterval)
    await browser.close()
  }
}

// ── Visual dark pattern detection ─────────────────────────────────────────────

export async function getVisualDarkPatterns(
  url: string,
  onLog: (msg: string, level: LogLevel) => void
): Promise<VisualDarkPatterns> {
  onLog("Scanning page visually for dark patterns...", "vision")
  const browser = await launchBrowser()
  try {
    const page = await newStealthPage(browser)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 })
    await page.waitForTimeout(2000)
    await dismissOverlays(page)

    // ── DOM-based detection ──
    const domHits = await page.evaluate(
      (): Array<{
        type: string
        description: string
        sel: string
        severity: "critical" | "medium" | "low"
      }> => {
        const hits: Array<{
          type: string
          description: string
          sel: string
          severity: "critical" | "medium" | "low"
        }> = []
        const text = document.body.innerText

        // Pre-checked checkboxes for add-ons/subscriptions
        document
          .querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
          .forEach((cb) => {
            const label =
              (
                cb.closest("label") ?? cb.nextElementSibling
              )?.textContent?.trim() ??
              cb.name ??
              ""
            if (
              label &&
              !/^(cart|remember me|i agree|terms|privacy)/i.test(label)
            ) {
              hits.push({
                type: "Pre-checked add-on",
                description: `Pre-checked: "${label.slice(0, 80)}"`,
                sel: 'input[type="checkbox"]:checked',
                severity: "critical",
              })
            }
          })

        // Countdown timers
        if (
          /\d{1,2}:\d{2}:\d{2}/.test(text) ||
          /\d+\s*(hours?|mins?|seconds?)\s*(left|remaining|only)/i.test(text)
        ) {
          hits.push({
            type: "Countdown timer",
            description: "Artificial urgency timer detected",
            sel: '[class*="timer"],[class*="countdown"],[class*="Timer"]',
            severity: "medium",
          })
        }

        // Fake stock scarcity
        if (
          /only\s+\d+\s+(left|remaining|in stock)/i.test(text) ||
          /selling fast|almost gone|limited stock/i.test(text)
        ) {
          hits.push({
            type: "Artificial scarcity",
            description: "Fake stock warning to pressure purchase",
            sel: '[class*="stock"],[class*="scarcity"],[class*="urgency"]',
            severity: "medium",
          })
        }

        // Cookie banner with no reject option
        const cookieEl = document.querySelector(
          '[id*="cookie"],[class*="cookie"],[id*="consent"],[class*="gdpr"]'
        )
        if (cookieEl) {
          const btns = [...document.querySelectorAll("button")]
          const hasReject = btns.some((b) =>
            /reject|decline|necessary only|refuse/i.test(b.textContent ?? "")
          )
          if (!hasReject) {
            hits.push({
              type: "Cookie consent manipulation",
              description: "Cookie banner has no reject/decline option",
              sel: '[id*="cookie"],[class*="cookie"]',
              severity: "medium",
            })
          }
        }

        // Price anchoring / crossed-out inflated original prices
        const strikethrus = document.querySelectorAll(
          's, del, [class*="original-price"],[class*="was-price"],[class*="strike"]'
        )
        if (strikethrus.length > 0) {
          hits.push({
            type: "Price anchoring",
            description:
              'Inflated "original" price displayed to make deal seem better',
            sel: 's, del, [class*="original-price"]',
            severity: "low",
          })
        }

        return hits
      }
    )

    const visualPatterns: VisualDarkPatterns["visualPatterns"] = []

    for (const hit of domHits) {
      let evidenceScreenshot: string | undefined
      try {
        const el = page.locator(hit.sel).first()
        if (await el.isVisible({ timeout: 1000 })) {
          await el.scrollIntoViewIfNeeded()
          await page.waitForTimeout(400)
          evidenceScreenshot = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`
        }
      } catch {
        /* no screenshot for this pattern */
      }

      visualPatterns.push({
        type: hit.type,
        description: hit.description,
        severity: hit.severity,
        evidenceScreenshot,
      })
    }

    // ── GPT-4o vision pass for anything the DOM scan missed ──
    const fullShot = (await page.screenshot({ fullPage: false })).toString(
      "base64"
    )
    const visionDataUrl = `data:image/png;base64,${fullShot}`

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const visionRes = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: visionDataUrl, detail: "high" },
            },
            {
              type: "text",
              text: `Identify dark patterns or manipulation tactics visible in this e-commerce screenshot that are NOT already in this list: ${domHits.map((h) => h.type).join(", ") || "none"}.
Look for: confusing button hierarchy, misleading colours (tiny grey decline vs big green accept), bait-and-switch pricing, hidden subscription fine print, fake review counts.
Return ONLY JSON — empty array if nothing new found:
{ "newPatterns": [{ "type": "...", "description": "...", "severity": "critical"|"medium"|"low" }] }`,
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
    })

    const visionParsed = JSON.parse(visionRes.choices[0].message.content!) as {
      newPatterns?: VisualDarkPatterns["visualPatterns"]
    }
    for (const p of visionParsed.newPatterns ?? []) {
      visualPatterns.push({ ...p, evidenceScreenshot: visionDataUrl })
    }

    const withShots = visualPatterns.filter((p) => p.evidenceScreenshot).length
    onLog(
      `Visual scan: ${visualPatterns.length} pattern(s), ${withShots} screenshot(s)`,
      withShots > 0 ? "warn" : "info"
    )

    return {
      visualPatterns,
      screenshotObservations:
        visualPatterns.length > 0
          ? `${visualPatterns.length} pattern(s) detected — DOM analysis + GPT-4o vision`
          : "No visual dark patterns detected.",
    }
  } finally {
    await browser.close()
  }
}

// ── Reddit sentiment ───────────────────────────────────────────────────────────

export async function getRedditSentiment(
  domain: string,
  onLog: (msg: string, level: LogLevel) => void,
  productQuery?: string,
  onScreenshot?: (dataUrl: string, label: string, streamId?: string) => void
): Promise<string> {
  onLog(
    `Searching Reddit for "${domain}"${productQuery ? ` + "${productQuery}"` : ""} reviews...`,
    "action"
  )
  const browser = await launchBrowser()
  try {
    type RedditPost = {
      title: string
      id: string
      subreddit: string
      permalink: string
      score: number
      selftext?: string
    }
    type RedditComment = { body: string; score: number }

    // ── Search helper — each call gets its own page to allow parallel requests ──
    async function searchReddit(q: string, limit = 8): Promise<RedditPost[]> {
      const pg = await newStealthPage(browser)
      try {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=year&limit=${limit}&type=link`
        await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 })
        await pg.waitForTimeout(600)
        if (onScreenshot) {
          try {
            const shot = await pg.screenshot({
              type: "jpeg",
              quality: 55,
              timeout: 2000,
            })
            onScreenshot(
              `data:image/jpeg;base64,${shot.toString("base64")}`,
              "💬 REDDIT AGENT · Search",
              "reddit-search"
            )
          } catch {
            // no-op
          }
        }
        const raw = (await pg.evaluate((): unknown => {
          try {
            return JSON.parse(document.body.innerText)
          } catch {
            return null
          }
        })) as { data?: { children?: Array<{ data: RedditPost }> } } | null
        return raw?.data?.children?.map((c) => c.data) ?? []
      } catch {
        return []
      } finally {
        await pg
          .context()
          .close()
          .catch(() => {
            /* ignore */
          })
      }
    }

    async function fetchComments(
      post: RedditPost
    ): Promise<{ comments: string[]; url: string }> {
      const pg = await newStealthPage(browser)
      try {
        const url = `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}.json?limit=20&depth=1`
        await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 })
        await pg.waitForTimeout(500)
        if (onScreenshot) {
          try {
            const shot = await pg.screenshot({
              type: "jpeg",
              quality: 55,
              timeout: 2000,
            })
            onScreenshot(
              `data:image/jpeg;base64,${shot.toString("base64")}`,
              `💬 REDDIT AGENT · r/${post.subreddit}`,
              "reddit-comments"
            )
          } catch {
            // no-op
          }
        }
        const raw = (await pg.evaluate((): unknown => {
          try {
            return JSON.parse(document.body.innerText)
          } catch {
            return null
          }
        })) as Array<{
          data?: { children?: Array<{ kind: string; data: RedditComment }> }
        }> | null
        const comments = (raw?.[1]?.data?.children ?? [])
          .filter(
            (c) =>
              c.kind === "t1" &&
              c.data.body &&
              !c.data.body.includes("[removed]") &&
              !c.data.body.includes("[deleted]")
          )
          .sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0))
          .map((c) => c.data.body.replace(/\n+/g, " ").trim())
          .filter((b) => b.length > 30 && b.length < 600)
          .slice(0, 8)
        return { comments, url: `https://reddit.com${post.permalink}` }
      } catch {
        return { comments: [], url: `https://reddit.com${post.permalink}` }
      } finally {
        await pg
          .context()
          .close()
          .catch(() => {
            /* ignore */
          })
      }
    }

    // ── Run brand + product searches in parallel ──────────────────────────────
    const [brandPosts, productPosts] = await Promise.all([
      searchReddit(`${domain} review experience quality`),
      productQuery?.trim()
        ? searchReddit(`${productQuery} ${domain}`, 5)
        : Promise.resolve([] as RedditPost[]),
    ])

    // Deduplicate by post ID, prefer higher-scored posts first
    const seenIds = new Set<string>()
    const allPosts = [...brandPosts, ...productPosts]
      .filter((p) => {
        if (seenIds.has(p.id)) return false
        seenIds.add(p.id)
        return true
      })
      .sort((a, b) => b.score - a.score)

    onLog(
      `Found ${allPosts.length} Reddit posts — reading top comments in parallel...`,
      "action"
    )

    // Fetch top-4 post comments in parallel
    const commentResults = await Promise.allSettled(
      allPosts.slice(0, 4).map((post) => fetchComments(post))
    )

    const allComments: string[] = []
    const postUrls: string[] = []

    for (const r of commentResults) {
      if (r.status === "fulfilled" && r.value.comments.length > 0) {
        allComments.push(...r.value.comments)
        postUrls.push(r.value.url)
      }
    }

    onLog(
      `Read ${allComments.length} comments from ${postUrls.length} posts — analysing...`,
      "vision"
    )

    // GPT-4o analysis
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Analyse these Reddit posts and comments about "${domain}"${productQuery ? ` and the product "${productQuery}"` : ""}.
Give a genuine, specific assessment based on real user experiences. Be honest — if people are unhappy, say so clearly.

POST TITLES (sorted by relevance):
${allPosts.map((p) => `• ${p.title}`).join("\n") || "(none found)"}

ACTUAL USER COMMENTS (${allComments.length} total, sorted by upvotes):
${allComments.join("\n---\n") || "(no comments retrieved)"}

Return ONLY valid JSON — no markdown:
{
  "overallSentiment": "positive" | "negative" | "mixed" | "unknown",
  "topFindings": ["3-5 specific findings with concrete detail — e.g. 'Multiple users report items arriving damaged' not vague summaries"],
  "keyQuotes": ["up to 3 verbatim exact quotes from the comments above — keep raw user voice, max 140 chars each, must be real words from comments"],
  "postUrls": ${JSON.stringify(postUrls.slice(0, 4))},
  "scamReports": ${allComments.some((c) => /scam|fraud|fake|never arrived|stolen/i.test(c))},
  "hiddenFeeComplaints": ${allComments.some((c) => /hidden fee|extra charge|unexpected charge|surprise/i.test(c))},
  "fakeProductComplaints": ${allComments.some((c) => /fake|counterfeit|knockoff|replica|not as described/i.test(c))},
  "qualityComplaints": ${allComments.some((c) => /poor quality|cheap|fell apart|broke|thin|flimsy|disappointing/i.test(c))},
  "postCount": ${allPosts.length}
}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })

    const result = JSON.parse(res.choices[0].message.content!) as Record<
      string,
      unknown
    >
    const sentiment = (result.overallSentiment as string) ?? "unknown"
    const scam = result.scamReports ? " ⚠ scam reports found" : ""
    onLog(`Reddit: ${sentiment}${scam}`, "success")
    return JSON.stringify(result)
  } catch (err) {
    onLog(
      `Reddit scan failed: ${err instanceof Error ? err.message : "unknown"}`,
      "warn"
    )
    return JSON.stringify({
      overallSentiment: "unknown",
      topFindings: [],
      keyQuotes: [],
      postUrls: [],
      scamReports: false,
      hiddenFeeComplaints: false,
      fakeProductComplaints: false,
      postCount: 0,
    })
  } finally {
    await browser.close()
  }
}
