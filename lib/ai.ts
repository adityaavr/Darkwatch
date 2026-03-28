import { GoogleGenerativeAI } from '@google/generative-ai'
import type { PageSnapshot, ScanResult, TrustScore, EthicalAnalysis } from './types'
import { fetchPage } from './browser'

// ── AI Provider ───────────────────────────────────────────────────────────────
// SWAP: set USE_OPENAI = true on hackathon day (needs OPENAI_API_KEY in .env.local)
const USE_OPENAI = false

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

/**
 * Extract raw HTML element snippets that are likely to contain dark patterns.
 * These are passed to the AI so it can reference the exact element in its response.
 */
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

  // Countdown / timer elements
  ;(html.match(/<[a-z][^>]*>[^<]*\d{1,2}:\d{2}(?::\d{2})?[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

  // Elements with countdown/timer class names
  ;(html.match(/<[^>]*class="[^"]*(?:countdown|timer|clock)[^"]*"[^>]*>[\s\S]{0,300}?<\/[a-z]+>/gi) ?? []).forEach(add)

  // Scarcity elements
  ;(html.match(/<[a-z][^>]*>[^<]*(?:only \d+\s*(?:left|remaining)|limited stock|low stock|last \d+\s+(?:item|unit))[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

  // Social proof elements
  ;(html.match(/<[a-z][^>]*>[^<]*\d+\s*(?:people|person|viewers?|customers?)\s*(?:viewing|watching|bought|looking|added)[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

  // Urgency copy elements
  ;(html.match(/<[a-z][^>]*>[^<]*(?:act now|don't miss|limited time|selling fast|hurry)[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

  // Sale / price badge elements
  ;(html.match(/<[^>]*class="[^"]*(?:badge|tag|label|sale|offer)[^"]*"[^>]*>[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

  // Strikethrough original prices
  ;(html.match(/<(?:s|strike|del)[^>]*>[^<]*\$[^<]+<\/(?:s|strike|del)>/gi) ?? []).forEach(add)

  // Confirm-shaming decline links (no thanks, etc.)
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

// ── Main entry ────────────────────────────────────────────────────────────────

export async function analyzeSnapshot(snapshot: PageSnapshot): Promise<ScanResult> {
  if (USE_OPENAI) {
    return analyzeWithOpenAI(snapshot)
  }
  return analyzeWithGemini(snapshot)
}

// ── Gemini ────────────────────────────────────────────────────────────────────

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

async function analyzeWithGemini(snapshot: PageSnapshot): Promise<ScanResult> {
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const dataContext = `PAGE DATA:
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

  const response = await model.generateContent(`${PROMPT}\n\n${dataContext}`)
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

  // Trustpilot only — ScamAdviser requires API key, replaced by ethical analysis
  const trustpilotUrl = `https://www.trustpilot.com/review/${domain}`
  onLog(`Checking Trustpilot for ${domain}...`)
  try {
    const html = await fetchPage(trustpilotUrl)
    const text = extractText(html).slice(0, 3000)
    signalTexts.push(`[Trustpilot]\n${text}`)
    sources_checked.push(trustpilotUrl)
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'blocked'
    sources_checked.push(`${trustpilotUrl} (unavailable: ${reason})`)
    onLog(`  ↳ Trustpilot unavailable — using AI knowledge only`)
  }

  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const trustPrompt = `You are a website trust analyst. Assess the trustworthiness of the domain "${domain}".

${signalTexts.length > 0 ? `Data from Trustpilot:\n\n${signalTexts.join('\n\n')}` : `No external review data was available. Use your training knowledge about "${domain}".`}

Return ONLY valid JSON — no markdown, no backticks:
{
  "trust_score": <integer 0-100, where 80-100=trusted, 60-79=caution, 30-59=suspicious, 0-29=dangerous>,
  "verdict": <"trusted" | "caution" | "suspicious" | "dangerous">,
  "signals": [<2-3 short bullet strings of specific evidence or reasoning>]
}`

  const response = await model.generateContent(trustPrompt)
  const text = response.response.text().replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(text) as Omit<TrustScore, 'sources_checked'>

  onLog(`Trust assessment: ${parsed.verdict} (score: ${parsed.trust_score})`)
  return { ...parsed, sources_checked }
}

// ── Ethical analysis ──────────────────────────────────────────────────────────

// Policy pages to try fetching — first hit per slot wins
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

  // Try each category of policy pages — take first successful fetch
  for (const candidates of POLICY_PAGE_CANDIDATES) {
    for (const path of candidates) {
      const fullUrl = new URL(path, baseUrl).href
      try {
        const html = await fetchPage(fullUrl)
        const text = extractText(html).slice(0, 3000)
        pageSections.push(`[${path}]\n${text}`)
        pages_checked.push(fullUrl)
        onLog(`  ↳ Fetched ${path}`)
        break // got one for this category, move on
      } catch {
        // try next candidate silently
      }
    }
  }

  if (pages_checked.length === 0) {
    onLog('  ↳ Policy pages unavailable — ethical analysis from AI knowledge only')
  }

  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })

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

  const response = await model.generateContent(ethicsPrompt)
  const text = response.response.text().replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(text) as Omit<EthicalAnalysis, 'pages_checked'>

  onLog(`Ethical analysis: ${parsed.overall} — ${parsed.concerns.length} concern(s) found`)
  return { ...parsed, pages_checked }
}

// ── OpenAI stub (activate on hackathon day) ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function analyzeWithOpenAI(_snapshot: PageSnapshot): Promise<ScanResult> {
  // TODO (hackathon day): uncomment and set USE_OPENAI = true
  //
  // import OpenAI from 'openai'
  // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  //
  // const dataContext = `...` // same as Gemini above
  //
  // const response = await openai.chat.completions.create({
  //   model: 'gpt-4o',
  //   messages: [
  //     { role: 'system', content: PROMPT },
  //     { role: 'user', content: dataContext },
  //   ],
  //   response_format: { type: 'json_object' },
  //   temperature: 0.1,
  // })
  // return JSON.parse(response.choices[0].message.content!) as ScanResult

  throw new Error('OpenAI not configured — set USE_OPENAI = false or add OPENAI_API_KEY')
}
