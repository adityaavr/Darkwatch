import { GoogleGenerativeAI } from "@google/generative-ai"
import OpenAI from "openai"
import { generateText } from "ai"
import { openai as openaiSDK } from "@ai-sdk/openai"
import type {
  PageSnapshot,
  ScanResult,
  SanitizationResult,
  TrustScore,
  EthicalAnalysis,
  ActionRecommendation,
} from "./types"
import { fetchPagePlain, getRedditSentiment } from "./browser"

// ── AI Provider ───────────────────────────────────────────────────────────────
const USE_OPENAI = true

// ── Extraction helpers ────────────────────────────────────────────────────────

export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000)
}

export function extractTimers(html: string): string[] {
  const matches = html.match(/\d{1,2}:\d{2}(:\d{2})?/g)
  return matches ? [...new Set(matches)].slice(0, 10) : []
}

export function extractSocialProof(html: string): string[] {
  const matches = html.match(
    /\d[\d,]*\s*(people|person|viewer|customer|buyer|shopper|watching|viewing|bought|sold|added|left)[^<]{0,80}/gi
  )
  return matches ? matches.slice(0, 5) : []
}

export function extractScarcity(html: string): string[] {
  const matches = html.match(
    /(only\s+\d+\s+(left|remaining|in stock)|limited\s+(stock|supply|availability)|\d+\s+(item|unit|piece)s?\s+(left|remaining))[^<]{0,80}/gi
  )
  return matches ? matches.slice(0, 5) : []
}

export function extractPrices(html: string): string[] {
  const matches = html.match(/\$[\d,]+\.?\d{0,2}|USD\s*[\d,]+\.?\d{0,2}/g)
  return matches ? [...new Set(matches)].slice(0, 10) : []
}

export function extractCTAText(html: string): string[] {
  const buttonMatches =
    html.match(/<button[^>]*>([^<]{2,60})<\/button>/gi) ?? []
  const submitMatches =
    html.match(/type=["']submit["'][^>]*value=["']([^"']{2,60})["']/gi) ?? []
  const text = [...buttonMatches, ...submitMatches]
    .map((m) => m.replace(/<[^>]+>/g, "").trim())
    .filter((t) => t.length > 1)
  return [...new Set(text)].slice(0, 10)
}

export function extractElementSnippets(html: string): string[] {
  const seen = new Set<string>()
  const snippets: string[] = []

  const add = (match: string) => {
    const cleaned = match.replace(/\s+/g, " ").trim()
    if (cleaned.length > 10 && cleaned.length < 500 && !seen.has(cleaned)) {
      seen.add(cleaned)
      snippets.push(cleaned)
    }
  }

  ;(
    html.match(/<[a-z][^>]*>[^<]*\d{1,2}:\d{2}(?::\d{2})?[^<]*<\/[a-z]+>/gi) ??
    []
  ).forEach(add)
  ;(
    html.match(
      /<[^>]*class="[^"]*(?:countdown|timer|clock)[^"]*"[^>]*>[\s\S]{0,300}?<\/[a-z]+>/gi
    ) ?? []
  ).forEach(add)
  ;(
    html.match(
      /<[a-z][^>]*>[^<]*(?:only \d+\s*(?:left|remaining)|limited stock|low stock|last \d+\s+(?:item|unit))[^<]*<\/[a-z]+>/gi
    ) ?? []
  ).forEach(add)
  ;(
    html.match(
      /<[a-z][^>]*>[^<]*\d+\s*(?:people|person|viewers?|customers?)\s*(?:viewing|watching|bought|looking|added)[^<]*<\/[a-z]+>/gi
    ) ?? []
  ).forEach(add)
  ;(
    html.match(
      /<[a-z][^>]*>[^<]*(?:act now|don't miss|limited time|selling fast|hurry)[^<]*<\/[a-z]+>/gi
    ) ?? []
  ).forEach(add)
  ;(
    html.match(
      /<[^>]*class="[^"]*(?:badge|tag|label|sale|offer)[^"]*"[^>]*>[^<]*<\/[a-z]+>/gi
    ) ?? []
  ).forEach(add)
  ;(
    html.match(/<(?:s|strike|del)[^>]*>[^<]*\$[^<]+<\/(?:s|strike|del)>/gi) ??
    []
  ).forEach(add)
  ;(
    html.match(/<[a-z][^>]*>[^<]*no[,\s]+thanks[^<]*<\/[a-z]+>/gi) ?? []
  ).forEach(add)

  return snippets.slice(0, 10)
}

export function buildSnapshot(
  url: string,
  html1: string,
  html2: string
): PageSnapshot {
  return {
    url,
    text_visit_1: extractText(html1),
    text_visit_2: extractText(html2),
    timers_visit_1: extractTimers(html1),
    timers_visit_2: extractTimers(html2),
    social_proof: extractSocialProof(html1),
    scarcity: extractScarcity(html1),
    prices: extractPrices(html1),
    cta_text: extractCTAText(html1),
    element_snippets: extractElementSnippets(html1),
  }
}

// ── Shared prompt ─────────────────────────────────────────────────────────────

const PROMPT = `You are a professional dark pattern detection system analyzing real website data.

TASK: Identify genuine psychological manipulation tactics. Be accurate — not too strict, not too loose.

CRITICAL RULES:
1. Only report patterns with ACTUAL evidence found in the page data
2. The "evidence" field must be an EXACT verbatim quote (≤80 chars) from the page text
3. Do NOT fabricate, infer, or hallucinate patterns — only report what you can prove
4. A genuine discount or sale is NOT a dark pattern unless demonstrably fake

NOT DARK PATTERNS — never flag these:
- Pure CTA buttons: "Buy Now", "Shop Now", "Save Now", "Add to Cart", "Get Started"
- Generic product labels: "Best Seller", "New Arrival", "Trending", "Popular"
- Standard sale banners: "Flash Sale", "Hot Deal", "Sale", "Up to X% off"
- Review counts and star ratings
- A price shown with a strikethrough original (normal retail practice)

TIMER ANALYSIS (most reliable signal):
- Compare timers_visit_1 vs timers_visit_2 (captured 8 seconds apart)
- If ANY timer value is HIGHER in visit 2 than visit 1 → timer reset = CONFIRMED FAKE COUNTDOWN (critical)
- If values are identical → static display, not conclusive — skip
- If values decreased by ~8 seconds → legitimate live countdown, not a dark pattern
- If no timers → no countdown issue

PATTERNS TO DETECT:
1. Fake countdown timer — ONLY report if timer comparison confirms reset. Requires timer data evidence.
2. Artificial scarcity — "only X left" or "X remaining" on mass-market products where the claim is unverifiable. A specific low number (e.g. "only 3 left") on a product sold by thousands of sellers IS suspicious. Generic "low stock" alone is borderline — only flag if paired with a specific number.
3. Fake social proof — unverifiable live counts: "47 people viewing this", "23 bought in the last hour". These are manipulative because they cannot be verified and are often fabricated. DO flag these when present.
4. Urgency copy — language that manufactures a specific false deadline: "offer ends in X hours", "today only", "expires tonight". Do NOT flag: "Flash Sale", "Hot Deal", "Limited time" alone without a specific deadline.
5. Hidden costs — prices that significantly increase from page display to checkout (requires price discrepancy in the data).
6. Confirmshaming — guilt-trip decline text like "No thanks, I hate saving money". Generic "No thanks" alone does not qualify.
7. Subscription trap — evidence of obscured auto-renewal or cancellation barriers in the page text.
8. Misleading defaults — pre-checked boxes for paid add-ons or newsletters.
9. Trick questions — double-negative opt-out language in forms.
10. Bait and switch — advertised items explicitly marked unavailable to lure visitors.

SEVERITY:
- critical: Directly deceptive with clear evidence (confirmed fake timer, provably false claim)
- medium: Psychologically manipulative (unverifiable viewer counts, specific scarcity numbers, specific false deadlines)
- low: Mildly misleading (borderline scarcity, confirmshaming, pre-checked boxes)

RISK SCORING:
- 0–10: Clean — nothing found
- 11–29: Low risk — one borderline concern
- 30–59: Medium risk — genuine manipulative patterns present
- 60–79: High risk — multiple or significant patterns
- 80–100: Critical — confirmed fake timers or provably false claims

ELEMENT HTML:
You will receive a list of raw HTML element snippets extracted from the page (element_snippets).
For each detected pattern, look through element_snippets and copy the ONE snippet that best
contains the evidence. Put it in "element_html". Keep it under 400 chars. If none match, use null.

Return ONLY valid JSON with no other text, no markdown, no backticks:
{
  "risk_score": <integer 0-100>,
  "verdict": <"clean" | "low risk" | "medium risk" | "high risk" | "critical">,
  "patterns": [
    {
      "pattern": <pattern name>,
      "severity": <"critical" | "medium" | "low">,
      "evidence": <exact verbatim quote ≤80 chars from the page text>,
      "explanation": <one specific sentence explaining why this is manipulative>,
      "element_html": <matching HTML snippet from element_snippets, ≤400 chars, or null>
    }
  ]
}`

// ── Shared data context builder ───────────────────────────────────────────────

function buildDataContext(snapshot: PageSnapshot): string {
  return `PAGE DATA:
URL: ${snapshot.url}

TEXT (visit 1):
${snapshot.text_visit_1}

TEXT (visit 2, 8s later):
${snapshot.text_visit_2}

TIMERS visit 1: ${JSON.stringify(snapshot.timers_visit_1)}
TIMERS visit 2: ${JSON.stringify(snapshot.timers_visit_2)}

SOCIAL PROOF claims: ${JSON.stringify(snapshot.social_proof)}
SCARCITY claims: ${JSON.stringify(snapshot.scarcity)}
PRICES found: ${JSON.stringify(snapshot.prices)}
CTA button text: ${JSON.stringify(snapshot.cta_text)}

ELEMENT SNIPPETS (raw HTML elements from the page likely containing dark patterns):
${snapshot.element_snippets.length > 0 ? snapshot.element_snippets.map((s, i) => `[${i}] ${s}`).join("\n") : "(none found)"}`
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function analyzeSnapshot(
  snapshot: PageSnapshot
): Promise<ScanResult> {
  if (USE_OPENAI) return analyzeWithOpenAI(snapshot)
  return analyzeWithGemini(snapshot)
}

// ── OpenAI GPT-4o via Vercel AI SDK ──────────────────────────────────────────

async function analyzeWithOpenAI(snapshot: PageSnapshot): Promise<ScanResult> {
  const { text } = await generateText({
    model: openaiSDK("gpt-4o"),
    system: PROMPT,
    prompt: buildDataContext(snapshot),
    temperature: 0.1,
  })

  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim()) as ScanResult
  } catch {
    return { risk_score: 0, verdict: "clean", patterns: [] }
  }
}

// ── Gemini (fallback) ─────────────────────────────────────────────────────────

async function analyzeWithGemini(snapshot: PageSnapshot): Promise<ScanResult> {
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" })
  const response = await model.generateContent(
    `${PROMPT}\n\n${buildDataContext(snapshot)}`
  )
  const text = response.response
    .text()
    .replace(/```json|```/g, "")
    .trim()
  return JSON.parse(text) as ScanResult
}

// ── Trust score ───────────────────────────────────────────────────────────────

export async function getTrustScore(
  domain: string,
  onLog: (msg: string) => void,
  onStreamUrl?: (url: string) => void,
  onTrustCheck?: (
    source: string,
    status: "scanning" | "done" | "failed",
    finding?: string
  ) => void,
  productQuery?: string, // passed to Reddit for product-aware search
  onBrowserScreenshot?: (
    dataUrl: string,
    label: string,
    streamId?: string
  ) => void
): Promise<TrustScore> {
  const signalTexts: string[] = []
  const sources_checked: string[] = []
  const domainName = domain.replace(/^www\./, "").split(".")[0]

  const SOURCES = [
    { key: "Trustpilot", url: `https://www.trustpilot.com/review/${domain}` },
    { key: "Sitejabber", url: `https://www.sitejabber.com/reviews/${domain}` },
    {
      key: "ScamAdviser",
      url: `https://www.scamadviser.com/check-website/${domain}`,
    },
    {
      key: "BBB",
      url: `https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(domain)}`,
    },
    {
      key: "ResellerRatings",
      url: `https://www.resellerratings.com/store/${domainName}`,
    },
  ]

  const WEB_REVIEW_QUERY_URL = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${domain} reviews complaints experiences`)}`

  // Mark all sources as scanning immediately so the UI shows all pills at once
  for (const src of SOURCES) onTrustCheck?.(src.key, "scanning")
  onTrustCheck?.("Web Review Snippets", "scanning")
  onTrustCheck?.("Reddit", "scanning")
  onTrustCheck?.("GPT-4o Analysis", "scanning")

  // Fetch review sites (plain fetch) + Reddit (Playwright) in parallel
  const [tp, sj, sa, bbb, rr, webSnippets, reddit] = await Promise.allSettled([
    fetchPagePlain(SOURCES[0].url),
    fetchPagePlain(SOURCES[1].url),
    fetchPagePlain(SOURCES[2].url),
    fetchPagePlain(SOURCES[3].url),
    fetchPagePlain(SOURCES[4].url),
    fetchPagePlain(WEB_REVIEW_QUERY_URL),
    getRedditSentiment(domain, onLog, productQuery, onBrowserScreenshot),
  ])

  // Process plain-fetch review sites
  const settled = [tp, sj, sa, bbb, rr]
  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i]
    const result = settled[i]
    if (result.status === "fulfilled") {
      const text = extractText(result.value).slice(0, 2500)
      // Quick star rating extraction for the finding label
      const stars = result.value.match(
        /(\d\.\d)\s*(out of\s*)?(\d\s*stars?|\/\s*\d)/i
      )
      const finding = stars ? `${stars[1]}★ found` : "data retrieved"
      signalTexts.push(`[${src.key}]\n${text}`)
      sources_checked.push(src.url)
      onTrustCheck?.(src.key, "done", finding)
    } else {
      sources_checked.push(`${src.url} (unavailable)`)
      onTrustCheck?.(src.key, "failed", "blocked or unavailable")
    }
  }

  // Process DuckDuckGo snippets as an additional external sentiment source
  if (webSnippets.status === "fulfilled") {
    const snippets = [
      ...webSnippets.value.matchAll(
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]{8,140})<\/a>[\s\S]{0,320}?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
      ),
    ]
      .slice(0, 4)
      .map((m) => {
        const title = m[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&#x27;/g, "'")
          .trim()
        const snip = m[2]
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&#x27;/g, "'")
          .replace(/\s+/g, " ")
          .trim()
        return `${title} — ${snip}`
      })
      .filter((s) => s.length > 20)

    if (snippets.length > 0) {
      signalTexts.push(`[Web review snippets]\n${snippets.join("\n")}`)
      sources_checked.push(WEB_REVIEW_QUERY_URL)
      onTrustCheck?.(
        "Web Review Snippets",
        "done",
        `${snippets.length} snippets`
      )
    } else {
      sources_checked.push(`${WEB_REVIEW_QUERY_URL} (no snippets)`)
      onTrustCheck?.("Web Review Snippets", "failed", "no snippets extracted")
    }
  } else {
    sources_checked.push(`${WEB_REVIEW_QUERY_URL} (unavailable)`)
    onTrustCheck?.("Web Review Snippets", "failed", "blocked or unavailable")
  }

  // Process Reddit — extract quotes and post URLs
  let redditKeyQuotes: string[] = []
  let redditPostUrls: string[] = []
  if (reddit.status === "fulfilled") {
    const r = JSON.parse(reddit.value) as Record<string, unknown>
    const sentiment = (r.overallSentiment as string) ?? "unknown"
    const scam = r.scamReports ? " · scam reports found" : ""
    const posts = r.postCount ? ` · ${r.postCount} posts` : ""
    redditKeyQuotes = (r.keyQuotes as string[] | undefined) ?? []
    redditPostUrls = (r.postUrls as string[] | undefined) ?? []
    signalTexts.push(`[Reddit community]\n${reddit.value}`)
    sources_checked.push(`reddit.com/search?q=${domain}+reviews`)
    onTrustCheck?.("Reddit", "done", `${sentiment}${scam}${posts}`)
  } else {
    sources_checked.push("reddit.com (unavailable)")
    onTrustCheck?.("Reddit", "failed", "blocked or unavailable")
  }

  const trustPrompt = `You are a website trust analyst. Assess the trustworthiness of the domain "${domain}".

${signalTexts.length > 0 ? `Data from review platforms and Reddit:\n\n${signalTexts.join("\n\n")}` : `No external review data was available. Use your training knowledge about "${domain}".`}

Return ONLY valid JSON — no markdown, no backticks:
{
  "trust_score": <integer 0-100, where 80-100=trusted, 60-79=caution, 30-59=suspicious, 0-29=dangerous>,
  "verdict": <"trusted" | "caution" | "suspicious" | "dangerous">,
  "signals": [<2-4 short bullet strings of specific evidence from the review data>],
  "keyQuotes": [<up to 3 direct verbatim quotes from the review data that best prove your verdict — real user words, max 140 chars each>]
}`

  let parsed: Omit<TrustScore, "sources_checked">

  if (USE_OPENAI) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: trustPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })
    parsed = JSON.parse(res.choices[0].message.content!) as Omit<
      TrustScore,
      "sources_checked"
    >
  } else {
    const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" })
    const response = await model.generateContent(trustPrompt)
    const text = response.response
      .text()
      .replace(/```json|```/g, "")
      .trim()
    parsed = JSON.parse(text) as Omit<TrustScore, "sources_checked">
  }

  // Merge Reddit quotes with any GPT-4o extracted quotes — deduplicate
  const allQuotes = [
    ...new Set([
      ...redditKeyQuotes,
      ...((parsed as TrustScore).keyQuotes ?? []),
    ]),
  ]
    .filter(Boolean)
    .slice(0, 4)

  onTrustCheck?.(
    "GPT-4o Analysis",
    "done",
    `${parsed.verdict} · ${parsed.trust_score}/100`
  )
  onLog(`Trust assessment: ${parsed.verdict} (score: ${parsed.trust_score})`)
  return {
    ...parsed,
    sources_checked,
    keyQuotes: allQuotes,
    sourceUrls: redditPostUrls,
  }
}

// ── Ethical analysis ──────────────────────────────────────────────────────────

const POLICY_PAGE_CANDIDATES = [
  ["/privacy-policy", "/privacy", "/legal/privacy"],
  ["/terms-of-service", "/terms", "/legal/terms", "/tos"],
  ["/about", "/about-us", "/sustainability", "/ethics"],
]

export async function getEthicalAnalysis(
  baseUrl: string,
  mainPageText: string,
  onLog: (msg: string) => void
): Promise<EthicalAnalysis> {
  onLog("Fetching policy pages for ethical analysis...")
  const pages_checked: string[] = []
  const pageSections: string[] = [`[Main page]\n${mainPageText.slice(0, 2000)}`]

  for (const candidates of POLICY_PAGE_CANDIDATES) {
    for (const path of candidates) {
      const fullUrl = new URL(path, baseUrl).href
      try {
        const html = await fetchPagePlain(fullUrl)
        const text = extractText(html).slice(0, 3000)
        pageSections.push(`[${path}]\n${text}`)
        pages_checked.push(fullUrl)
        onLog(`  ↳ Fetched ${path}`)
        break
      } catch {
        // try next candidate silently
      }
    }
  }

  if (pages_checked.length === 0) {
    onLog("  ↳ Policy pages unavailable — checking external sources...")
  }

  const domain = new URL(baseUrl).hostname.replace("www.", "")

  // ── DuckDuckGo news: ethics/labor headlines ─────────────────────────────────
  // html.duckduckgo.com/html/ is the no-JS fallback — plain HTTP accessible.
  let newsHeadlines = ""
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(domain + " labor practices ethics controversy")}&df=y`
    const ddgHtml = await fetchPagePlain(ddgUrl)
    const headlines = [
      ...ddgHtml.matchAll(
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]{5,120})<\/a>/g
      ),
    ]
      .slice(0, 4)
      .map((m) =>
        m[1]
          .replace(/&#x27;/g, "'")
          .replace(/&amp;/g, "&")
          .trim()
      )
      .filter((h) => h.length > 10)
    if (headlines.length > 0) {
      newsHeadlines = headlines.join("\n")
      onLog(`  ↳ ${headlines.length} ethics news headline(s) found`)
    }
  } catch {
    /* DDG unavailable — continue without news */
  }

  // ── Good On You sustainability rating (best-effort) ──────────────────────────
  // Will fail for most brands due to Cloudflare — falls through silently.
  let goodOnYouText = ""
  try {
    const slug = domain
      .replace(/\.(com|co\.uk|net|org|io)$/, "")
      .replace(/\./g, "-")
    const goyHtml = await fetchPagePlain(
      `https://good-on-you.eco/brands/${slug}/`
    )
    if (
      !goyHtml.includes("Just a moment") &&
      !goyHtml.includes("cf-browser-verification")
    ) {
      goodOnYouText = extractText(goyHtml).slice(0, 800)
      onLog("  ↳ Good On You rating fetched")
    }
  } catch {
    /* blocked — skip */
  }

  const ethicsPrompt = `You are an ethical business analyst reviewing the website "${domain}".

Analyse the following page content for ethical concerns across these categories:
- Data Privacy: excessive tracking, selling user data, dark patterns in consent flows, vague data policies
- Environmental: greenwashing, false sustainability claims, high environmental impact without acknowledgement (especially fast fashion)
- Labor Practices: supply chain concerns, worker conditions, use of exploitative labor
- Business Practices: manipulative subscription models, hidden auto-renewals, predatory pricing
- Transparency: unclear pricing, hidden fees, misleading product claims
- Consumer Rights: unfair return policies, difficult cancellation, targeting vulnerable groups

PAGE CONTENT:
${pageSections.join("\n\n---\n\n")}
${newsHeadlines ? `\n\nRECENT NEWS / MEDIA (labor & ethics):\n${newsHeadlines}` : ""}
${goodOnYouText ? `\n\nGOOD ON YOU SUSTAINABILITY RATING:\n${goodOnYouText}` : ""}

Rules:
1. Only flag genuine, evidenced concerns — not speculation
2. If content from privacy/terms pages is available, cite specific clauses
3. For well-known companies use your training knowledge for supply chain / environmental context
4. "overall" = concerning if 2+ high severity; mixed if any medium; acceptable if only low; good if none

Return ONLY valid JSON — no markdown, no backticks:
{
  "overall": <"concerning" | "mixed" | "acceptable" | "good">,
  "concerns": [
    {
      "category": <one of the 6 categories above>,
      "severity": <"high" | "medium" | "low">,
      "concern": <short title ≤60 chars>,
      "evidence": <one specific sentence of evidence or reasoning>
    }
  ]
}`

  let parsed: Omit<EthicalAnalysis, "pages_checked">

  if (USE_OPENAI) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: ethicsPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })
    parsed = JSON.parse(res.choices[0].message.content!) as Omit<
      EthicalAnalysis,
      "pages_checked"
    >
  } else {
    const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" })
    const response = await model.generateContent(ethicsPrompt)
    const text = response.response
      .text()
      .replace(/```json|```/g, "")
      .trim()
    parsed = JSON.parse(text) as Omit<EthicalAnalysis, "pages_checked">
  }

  onLog(
    `Ethical analysis: ${parsed.overall} — ${parsed.concerns.length} concern(s) found`
  )
  return { ...parsed, pages_checked }
}

// ── Action recommendation ─────────────────────────────────────────────────────

export async function getActionRecommendation(
  url: string,
  productQuery: string,
  scanResult: ScanResult,
  onLog: (msg: string) => void
): Promise<ActionRecommendation> {
  onLog("Building action recommendation...")

  const origin = scanResult.checkoutAnalysis
  const checkout = scanResult.checkoutAnalysis
  const trust = scanResult.trustScore
  const patterns = scanResult.patterns
  const visual = scanResult.visualDarkPatterns

  const domain = (() => {
    try {
      return new URL(url).hostname.replace("www.", "")
    } catch {
      return url
    }
  })()

  const context = `
Site: ${domain}
Product searched: "${productQuery || "unspecified"}"
Risk score: ${scanResult.risk_score}/100
Trust verdict: ${trust?.verdict ?? "unknown"}
Critical patterns detected: ${
    patterns
      .filter((p) => p.severity === "critical")
      .map((p) => p.pattern)
      .join(", ") || "none"
  }
Hidden fees: ${checkout?.hiddenFeesDetected ? `yes — product ${checkout.productPrice} vs checkout ${checkout.checkoutTotal}` : "none detected"}
Pre-checked add-ons: ${checkout?.preCheckedItems.join(", ") || "none"}
Trust signals: ${trust?.signals.slice(0, 2).join(" | ") || "none"}
Visual patterns: ${
    visual?.visualPatterns
      .slice(0, 2)
      .map((p) => p.type)
      .join(", ") || "none"
  }
`.trim()

  const prompt = `You are DarkWatch, an AI shopping bodyguard. Based on this scan, decide the ONE action the user should take.

${context}

Rules:
- If the site is fundamentally untrustworthy or the product is heavily marked up from a wholesale source → verdict "skip", recommend buying from a competitor or direct source
- If trust is OK but there are junk fees or pre-checked add-ons → verdict "sketchy", recommend stripping fees
- If everything looks fine → verdict "safe", confirm it's safe to buy

If the verdict is "skip", recommend the BEST alternative marketplace for this product type:
- Electronics / gadgets → https://www.amazon.com/s?k=<encoded-query>
- Fashion / apparel / accessories → https://www.amazon.com/s?k=<encoded-query> or https://www.temu.com/search_result.html?search_key=<encoded-query>
- Home goods → https://www.amazon.com/s?k=<encoded-query> or https://www.wayfair.com/keyword.php?keyword=<encoded-query>
- Handmade / jewellery → https://www.etsy.com/search?q=<encoded-query>
- Wholesale / bulk → https://www.aliexpress.com/wholesale?SearchText=<encoded-query>
- General → https://www.amazon.com/s?k=<encoded-query>
Use null for ctaUrl if verdict is "safe" or "sketchy" (just describe the fees to avoid).

Return ONLY valid JSON:
{
  "verdict": "safe" | "sketchy" | "skip",
  "headline": "one punchy finding, max 50 chars, e.g. '540% markup on a $2 product'",
  "topFindings": ["2-3 short bullet strings, each under 60 chars"],
  "ctaLabel": "action button text, e.g. 'Buy on Amazon →' or 'Strip $9.98 in fees →' or 'Safe to checkout →'",
  "ctaUrl": "full URL or null",
  "ctaSubtext": "one line naming platform + benefit, e.g. 'Amazon · ships in 2 days, no hidden fees'"
}`

  const { text } = await generateText({
    model: openaiSDK("gpt-4o-mini"),
    prompt,
    temperature: 0.2,
  })

  const parsed = JSON.parse(
    text.replace(/```json|```/g, "").trim()
  ) as ActionRecommendation

  // Attach the most compelling screenshot if we have one
  const topScreenshot =
    visual?.visualPatterns.find(
      (p) => p.evidenceScreenshot && p.severity === "critical"
    )?.evidenceScreenshot ??
    visual?.visualPatterns.find((p) => p.evidenceScreenshot)?.evidenceScreenshot

  if (topScreenshot) parsed.evidenceScreenshot = topScreenshot

  onLog(`Verdict: ${parsed.verdict.toUpperCase()} — ${parsed.headline}`)
  return parsed
}

// ── Synthesise action recommendation from SanitizationResult ─────────
// Called after the cart-clean agent finishes — GPT-4o synthesises the verdict.

export async function synthesiseAction(
  s: SanitizationResult,
  query: string,
  onLog: (msg: string) => void
): Promise<ActionRecommendation> {
  onLog("GPT-4o synthesising verdict...")

  const fees = s.junkFeesRemoved ?? []
  const totalSaved = fees.reduce(
    (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, "") || "0"),
    0
  )

  const prompt = `You are DarkWatch, an AI shopping protection agent. Based on this shopping analysis, produce one clear, honest verdict for the user.

═══ SCAN DATA ═══
Product searched: "${query}"
Advertised price: ${s.basePrice}
True price (after fees removed): ${s.finalPrice}
Junk fees found: ${
    fees.length > 0
      ? fees
          .map((f) => `• ${f.name} (${f.amount}): ${f.description}`)
          .join("\n")
      : "none"
  }
Total fees stripped: $${totalSaved.toFixed(2)}

Review trust score: ${s.trustScore ?? "unknown"}/100
Fake/incentivised reviews: ${s.fakeReviewsDetected ? "YES — detected" : "no"}

Product origin analysis:
- Likely dropshipped: ${s.productOrigin?.isDropshipped ? "YES" : "no"}
- Wholesale price estimate: ${s.productOrigin?.wholesalePriceEstimate ?? "unknown"}
- Retail markup: ${s.productOrigin?.markupPercentage ?? "unknown"}
- Sourced from: ${s.productOrigin?.likelySourcedFrom ?? "unknown"}
- Agent analysis: ${s.productOrigin?.analysis ?? "N/A"}

═══ VERDICT RULES ═══
"skip" → massive markup (>200%) from a wholesale source, OR multiple junk fees PLUS fake reviews, OR clearly untrustworthy site
"sketchy" → some junk fees found, OR moderate markup, OR fake reviews detected, OR trust score below 50
"safe" → no meaningful concerns — product appears legitimate, reviews genuine, no hidden fees

═══ OUTPUT RULES ═══
- headline: single most important finding, punchy, max 55 chars
- topFindings: 2-3 specific bullets, each under 70 chars
- ctaLabel: clear action e.g. "Buy on Amazon →" or "Safe to buy →" or "Strip $8 in fees →"
- ctaUrl: for dropshipped/overpriced items, pick the BEST alternative marketplace based on product type:
    • Electronics / gadgets → https://www.amazon.com/s?k=<encoded-query>
    • Fashion / apparel / accessories → https://www.amazon.com/s?k=<encoded-query> OR https://www.temu.com/search_result.html?search_key=<encoded-query>
    • Home goods / furniture → https://www.amazon.com/s?k=<encoded-query> OR https://www.wayfair.com/keyword.php?keyword=<encoded-query>
    • Handmade / unique / jewellery → https://www.etsy.com/search?q=<encoded-query>
    • Budget / everyday items → https://www.amazon.com/s?k=<encoded-query>
    • Wholesale / bulk → https://www.aliexpress.com/wholesale?SearchText=<encoded-query>
    • General → https://www.amazon.com/s?k=<encoded-query>
  Use null if the product is fine where it is.
- ctaSubtext: one short line naming the platform and the benefit e.g. "Amazon · ships in 2 days, no hidden fees" or "Etsy · handmade, better price"

Return ONLY valid JSON, no markdown:
{
  "verdict": "safe" | "sketchy" | "skip",
  "headline": "...",
  "topFindings": ["...", "..."],
  "ctaLabel": "...",
  "ctaUrl": "..." | null,
  "ctaSubtext": "..."
}`

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 400,
  })

  const parsed = JSON.parse(
    res.choices[0].message.content!
  ) as ActionRecommendation
  if (s.screenshotUrl) parsed.evidenceScreenshot = s.screenshotUrl

  // Attach the product image so the UI can show a thumbnail next to the "buy here instead" CTA
  if (s.productImageUrl && parsed.ctaUrl) {
    parsed.ctaProductImageUrl = s.productImageUrl
  }

  onLog(`Verdict: ${parsed.verdict.toUpperCase()} — ${parsed.headline}`)
  return parsed
}
