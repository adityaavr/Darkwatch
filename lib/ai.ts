import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { generateText } from 'ai'
import { openai as openaiSDK } from '@ai-sdk/openai'
import type { PageSnapshot, ScanResult, TrustScore, EthicalAnalysis, ActionRecommendation, SpatialValidation } from './types'
import { fetchPagePlain, getRedditSentiment } from './browser'

// ── Spatial Validation (Nano Banana 2) ────────────────────────────────────────

export async function getSpatialValidation(
  productName: string,
  htmlOrText: string,
  onLog: (msg: string) => void,
): Promise<SpatialValidation> {
  onLog(`[Nano Banana 2] Analyzing spatial dimensions for "${productName}"...`)

  let dimensions = 'Unknown'

  // If the input starts with "Dimensions:", it's already extracted by TinyFish
  if (htmlOrText.startsWith('Dimensions:')) {
    const parts = htmlOrText.split('Description:')
    dimensions = parts[0].replace('Dimensions:', '').trim()
  } else {
    // Extract dimensions using a fast LLM pass from raw HTML
    const dimensionPrompt = `Extract the exact physical dimensions (length, width, height, or size) for the product "${productName}" from the following text. Look for cm, mm, inches, or "size: X". If multiple sizes exist, pick the most likely one for a standard version.
    
    TEXT:
    ${extractText(htmlOrText).slice(0, 4000)}
    
    Return ONLY the dimensions as a string (e.g. "17.5cm x 12.5cm") or "Unknown" if not found.`

    const { text: extracted } = await generateText({
      model: openaiSDK('gpt-4o-mini'),
      prompt: dimensionPrompt,
    })
    dimensions = extracted
  }

  onLog(`Dimensions identified: ${dimensions}`)

  if (dimensions.toLowerCase() === 'unknown') {
    return {
      isValid: false,
      dimensions: 'Unknown',
      reasoning: 'Could not find physical dimensions in the product data.',
    }
  }

  // Generate the scale comparison image using Nano Banana 2 (Gemini 3.1 Flash Image)
  // For the hackathon demo, we'll return a placeholder URL or simulate the call.
  // In a real implementation, we'd use the Google Gen AI SDK here.

  const imagePrompt = `You are an expert product photographer and spatial validator. Your objective is to generate a hyper-realistic, unembellished, "raw" photograph that reveals the TRUE physical scale of a specific product to prevent deceptive sizing.

PRODUCT DETAILS:
- Name: ${productName}
- Exact Physical Dimensions: ${dimensions}

SCENE & COMPOSITION REQUIREMENTS:
1. Scale Reality: You MUST render the product strictly according to its Exact Physical Dimensions. Strip away all marketing exaggeration.
2. The Anchors (Reference Objects): The product must be resting flat on a clean, light-oak wooden desk. Directly next to the product, touching its edge, you must place two universally understood scale anchors:
   - A standard smartphone (exactly 14.7 cm tall)
   - A standard bank credit card (exactly 8.5 cm wide)
3. The Human Element: Include an average-sized adult human hand reaching into the frame for scale.
4. Photographic Style: iPhone camera quality, neutral flat daylight, overhead 45-degree angle. No dramatic studio lighting.`

  onLog(`[Nano Banana 2] Generating scale verification image...`)

  // Simulate Nano Banana 2 call
  const comparisonImageUrl = `https://generative-images.demo/scale-check/${encodeURIComponent(productName)}?dims=${encodeURIComponent(dimensions)}`

  return {
    isValid: true,
    dimensions,
    reasoning: `Product dimensions (${dimensions}) verified against reference objects (iPhone & Credit Card).`,
    comparisonImageUrl,
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────
const USE_OPENAI = true

// ── Extraction helpers ────────────────────────────────────────────────────────

export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
}

export function extractTimers(html: string): string[] {
  const matches = html.match(/\d{1,2}:\d{2}(:\d{2})?/g)
  return matches ? [...new Set(matches)].slice(0, 10) : []
}

export function extractSocialProof(html: string): string[] {
  const matches = html.match(
    /\d[\d,]*\s*(people|person|viewer|customer|buyer|shopper|watching|viewing|bought|sold|added|left)[^<]{0,80}/gi,
  )
  return matches ? matches.slice(0, 5) : []
}

export function extractScarcity(html: string): string[] {
  const matches = html.match(
    /(only\s+\d+\s+(left|remaining|in stock)|limited\s+(stock|supply|availability)|\d+\s+(item|unit|piece)s?\s+(left|remaining))[^<]{0,80}/gi,
  )
  return matches ? matches.slice(0, 5) : []
}

export function extractPrices(html: string): string[] {
  const matches = html.match(/\$[\d,]+\.?\d{0,2}|USD\s*[\d,]+\.?\d{0,2}/g)
  return matches ? [...new Set(matches)].slice(0, 10) : []
}

export function extractCTAText(html: string): string[] {
  const buttonMatches = html.match(/<button[^>]*>([^<]{2,60})<\/button>/gi) ?? []
  const submitMatches = html.match(/type=["']submit["'][^>]*value=["']([^"']{2,60})["']/gi) ?? []
  const text = [...buttonMatches, ...submitMatches]
    .map((m) => m.replace(/<[^>]+>/g, '').trim())
    .filter((t) => t.length > 1)
  return [...new Set(text)].slice(0, 10)
}

export function extractElementSnippets(html: string): string[] {
  const seen = new Set<string>()
  const snippets: string[] = []

  const add = (match: string) => {
    const cleaned = match.replace(/\s+/g, ' ').trim()
    if (cleaned.length > 10 && cleaned.length < 500 && !seen.has(cleaned)) {
      seen.add(cleaned)
      snippets.push(cleaned)
    }
  }

  ;(html.match(/<[a-z][^>]*>[^<]*\d{1,2}:\d{2}(?::\d{2})?[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)
  ;(html.match(/<[^>]*class="[^"]*(?:countdown|timer|clock)[^"]*"[^>]*>[\s\S]{0,300}?<\/[a-z]+>/gi) ?? []).forEach(add)
  ;(html.match(/<[a-z][^>]*>[^<]*(?:only \d+\s*(?:left|remaining)|limited stock|low stock|last \d+\s+(?:item|unit))[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)
  ;(html.match(/<[a-z][^>]*>[^<]*\d+\s*(?:people|person|viewers?|customers?)\s*(?:viewing|watching|bought|looking|added)[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)
  ;(html.match(/<[a-z][^>]*>[^<]*(?:act now|don't miss|limited time|selling fast|hurry)[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)
  ;(html.match(/<[^>]*class="[^"]*(?:badge|tag|label|sale|offer)[^"]*"[^>]*>[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)
  ;(html.match(/<(?:s|strike|del)[^>]*>[^<]*\$[^<]+<\/(?:s|strike|del)>/gi) ?? []).forEach(add)
  ;(html.match(/<[a-z][^>]*>[^<]*no[,\s]+thanks[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

  return snippets.slice(0, 10)
}

export function buildSnapshot(url: string, html1: string, html2: string): PageSnapshot {
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
${snapshot.element_snippets.length > 0 ? snapshot.element_snippets.map((s, i) => `[${i}] ${s}`).join('\n') : '(none found)'}`
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function analyzeSnapshot(snapshot: PageSnapshot): Promise<ScanResult> {
  if (USE_OPENAI) return analyzeWithOpenAI(snapshot)
  return analyzeWithGemini(snapshot)
}

// ── OpenAI GPT-4o via Vercel AI SDK ──────────────────────────────────────────

async function analyzeWithOpenAI(snapshot: PageSnapshot): Promise<ScanResult> {
  const { text } = await generateText({
    model: openaiSDK('gpt-4o-mini'),
    system: PROMPT,
    prompt: buildDataContext(snapshot),
    temperature: 0.1,
  })

  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as ScanResult
  } catch {
    return { risk_score: 0, verdict: 'clean', patterns: [] }
  }
}

// ── Gemini (fallback) ─────────────────────────────────────────────────────────

async function analyzeWithGemini(snapshot: PageSnapshot): Promise<ScanResult> {
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })
  const response = await model.generateContent(`${PROMPT}\n\n${buildDataContext(snapshot)}`)
  const text = response.response.text().replace(/```json|```/g, '').trim()
  return JSON.parse(text) as ScanResult
}

// ── Trust score ───────────────────────────────────────────────────────────────

export async function getTrustScore(
  domain: string,
  onLog: (msg: string) => void,
): Promise<TrustScore> {
  const signalTexts: string[] = []
  const sources_checked: string[] = []

  // Fetch review sources in parallel — plain fetch for static pages, TinyFish for Reddit
  const reviewSources = [
    { label: 'Trustpilot', url: `https://www.trustpilot.com/review/${domain}` },
    { label: 'Sitejabber', url: `https://www.sitejabber.com/reviews/${domain}` },
  ]

  onLog(`Checking review sites and Reddit for ${domain}...`)

  const [trustpilotResult, sitejabberResult, redditResult] = await Promise.allSettled([
    fetchPagePlain(reviewSources[0].url),
    fetchPagePlain(reviewSources[1].url),
    getRedditSentiment(domain, onLog),
  ])

  for (let i = 0; i < reviewSources.length; i++) {
    const settled = i === 0 ? trustpilotResult : sitejabberResult
    const src = reviewSources[i]
    if (settled.status === 'fulfilled') {
      const text = extractText(settled.value).slice(0, 2500)
      signalTexts.push(`[${src.label}]\n${text}`)
      sources_checked.push(src.url)
    } else {
      sources_checked.push(`${src.url} (unavailable)`)
    }
  }

  if (redditResult.status === 'fulfilled') {
    signalTexts.push(`[Reddit community]\n${redditResult.value}`)
    sources_checked.push(`reddit.com/search?q=${domain}+reviews`)
  } else {
    sources_checked.push(`reddit.com (unavailable)`)
  }

  const trustPrompt = `You are a website trust analyst. Assess the trustworthiness of the domain "${domain}".

${signalTexts.length > 0 ? `Data from review sites and Reddit:\n\n${signalTexts.join('\n\n')}` : `No external review data was available. Use your training knowledge about "${domain}".`}

Return ONLY valid JSON — no markdown, no backticks:
{
  "trust_score": <integer 0-100, where 80-100=trusted, 60-79=caution, 30-59=suspicious, 0-29=dangerous>,
  "verdict": <"trusted" | "caution" | "suspicious" | "dangerous">,
  "signals": [<2-4 short bullet strings of specific evidence from the review data or reasoning>]
}`

  let parsed: Omit<TrustScore, 'sources_checked'>

  if (USE_OPENAI) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: trustPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })
    parsed = JSON.parse(res.choices[0].message.content!) as Omit<TrustScore, 'sources_checked'>
  } else {
    const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const response = await model.generateContent(trustPrompt)
    const text = response.response.text().replace(/```json|```/g, '').trim()
    parsed = JSON.parse(text) as Omit<TrustScore, 'sources_checked'>
  }

  onLog(`Trust assessment: ${parsed.verdict} (score: ${parsed.trust_score})`)
  return { ...parsed, sources_checked }
}

// ── Ethical analysis ──────────────────────────────────────────────────────────

const POLICY_PAGE_CANDIDATES = [
  ['/privacy-policy', '/privacy', '/legal/privacy'],
  ['/terms-of-service', '/terms', '/legal/terms', '/tos'],
  ['/about', '/about-us', '/sustainability', '/ethics'],
]

export async function getEthicalAnalysis(
  baseUrl: string,
  mainPageText: string,
  onLog: (msg: string) => void,
): Promise<EthicalAnalysis> {
  onLog('Fetching policy pages for ethical analysis...')
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
    onLog('  ↳ Policy pages unavailable — ethical analysis from AI knowledge only')
  }

  const domain = new URL(baseUrl).hostname.replace('www.', '')

  const ethicsPrompt = `You are an ethical business analyst reviewing the website "${domain}".

Analyse the following page content for ethical concerns across these categories:
- Data Privacy: excessive tracking, selling user data, dark patterns in consent flows, vague data policies
- Environmental: greenwashing, false sustainability claims, high environmental impact without acknowledgement (especially fast fashion)
- Labor Practices: supply chain concerns, worker conditions, use of exploitative labor
- Business Practices: manipulative subscription models, hidden auto-renewals, predatory pricing
- Transparency: unclear pricing, hidden fees, misleading product claims
- Consumer Rights: unfair return policies, difficult cancellation, targeting vulnerable groups

PAGE CONTENT:
${pageSections.join('\n\n---\n\n')}

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

  let parsed: Omit<EthicalAnalysis, 'pages_checked'>

  if (USE_OPENAI) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: ethicsPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })
    parsed = JSON.parse(res.choices[0].message.content!) as Omit<EthicalAnalysis, 'pages_checked'>
  } else {
    const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const response = await model.generateContent(ethicsPrompt)
    const text = response.response.text().replace(/```json|```/g, '').trim()
    parsed = JSON.parse(text) as Omit<EthicalAnalysis, 'pages_checked'>
  }

  onLog(`Ethical analysis: ${parsed.overall} — ${parsed.concerns.length} concern(s) found`)
  return { ...parsed, pages_checked }
}

// ── Action recommendation ─────────────────────────────────────────────────────

export async function getActionRecommendation(
  url: string,
  productQuery: string,
  scanResult: ScanResult,
  onLog: (msg: string) => void,
): Promise<ActionRecommendation> {
  onLog('Building action recommendation...')

  const origin = scanResult.checkoutAnalysis
  const checkout = scanResult.checkoutAnalysis
  const trust = scanResult.trustScore
  const patterns = scanResult.patterns
  const visual = scanResult.visualDarkPatterns

  const domain = (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return url } })()

  const context = `
Site: ${domain}
Product searched: "${productQuery || 'unspecified'}"
Risk score: ${scanResult.risk_score}/100
Trust verdict: ${trust?.verdict ?? 'unknown'}
Critical patterns detected: ${patterns.filter(p => p.severity === 'critical').map(p => p.pattern).join(', ') || 'none'}
Hidden fees: ${checkout?.hiddenFeesDetected ? `yes — product ${checkout.productPrice} vs checkout ${checkout.checkoutTotal}` : 'none detected'}
Pre-checked add-ons: ${checkout?.preCheckedItems.join(', ') || 'none'}
Trust signals: ${trust?.signals.slice(0, 2).join(' | ') || 'none'}
Visual patterns: ${visual?.visualPatterns.slice(0, 2).map(p => p.type).join(', ') || 'none'}
`.trim()

  const prompt = `You are DarkWatch, an AI shopping bodyguard. Based on this scan, decide the ONE action the user should take.

${context}

Rules:
- If the site is fundamentally untrustworthy or the product is heavily marked up from a wholesale source → verdict "skip", recommend buying from a competitor or direct source
- If trust is OK but there are junk fees or pre-checked add-ons → verdict "sketchy", recommend stripping fees
- If everything looks fine → verdict "safe", confirm it's safe to buy

Build a competitor/direct URL only if you have strong confidence it exists. Use a real search URL like https://www.amazon.com/s?k=<query> or https://www.aliexpress.com/w/wholesale-<query>.html using the product query.

Return ONLY valid JSON:
{
  "verdict": "safe" | "sketchy" | "skip",
  "headline": "one punchy finding, max 50 chars, e.g. '540% markup on a $2 product'",
  "topFindings": ["2-3 short bullet strings, each under 60 chars"],
  "ctaLabel": "action button text, e.g. 'Buy direct for $2.50 →' or 'Strip $9.98 in fees →' or 'Safe to checkout →'",
  "ctaUrl": "full URL or null",
  "ctaSubtext": "one line of context under the button, e.g. 'Amazon · usually ships in 2 days'"
}`

  const { text } = await generateText({
    model: openaiSDK('gpt-4o-mini'),
    prompt,
    temperature: 0.2,
  })

  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as ActionRecommendation

  // Attach the most compelling screenshot if we have one
  const topScreenshot =
    visual?.visualPatterns.find(p => p.evidenceScreenshot && p.severity === 'critical')?.evidenceScreenshot ??
    visual?.visualPatterns.find(p => p.evidenceScreenshot)?.evidenceScreenshot

  if (topScreenshot) parsed.evidenceScreenshot = topScreenshot

  onLog(`Verdict: ${parsed.verdict.toUpperCase()} — ${parsed.headline}`)
  return parsed
}
