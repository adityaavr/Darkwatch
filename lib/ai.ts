import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { PageSnapshot, ScanResult, TrustScore, EthicalAnalysis } from './types'
import { fetchPage } from './browser'

// ── AI Provider ───────────────────────────────────────────────────────────────
// PIVOTED TO OPENAI FOR HACKATHON
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

/**
 * Extract raw HTML element snippets that are likely to contain dark patterns.
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
  // Scarcity elements
  ;(html.match(/<[a-z][^>]*>[^<]*(?:only \d+\s*(?:left|remaining)|limited stock|low stock|last \d+\s+(?:item|unit))[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)
  // Urgency copy elements
  ;(html.match(/<[a-z][^>]*>[^<]*(?:act now|don't miss|limited time|selling fast|hurry)[^<]*<\/[a-z]+>/gi) ?? []).forEach(add)

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
  return analyzeWithOpenAI(snapshot)
}

const DARK_PATTERN_PROMPT = `You are a professional dark pattern detection system analyzing real website data.
TASK: Identify genuine psychological manipulation tactics. 
Return ONLY valid JSON.`

async function analyzeWithOpenAI(snapshot: PageSnapshot): Promise<ScanResult> {
  const dataContext = `PAGE DATA:
URL: ${snapshot.url}
TEXT: ${snapshot.text_visit_1}
TIMERS: ${JSON.stringify(snapshot.timers_visit_1)}`

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: DARK_PATTERN_PROMPT,
    prompt: dataContext,
  })

  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as ScanResult
  } catch {
    // Fallback if AI fails to return clean JSON
    return { risk_score: 0, verdict: 'clean', patterns: [] }
  }
}

// ── Trust score ───────────────────────────────────────────────────────────────

export async function getTrustScore(
  domain: string,
  onLog: (msg: string) => void,
): Promise<TrustScore> {
  onLog(`Checking trust for ${domain}...`)
  
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: 'You are a website trust analyst. Return JSON.',
    prompt: `Assess domain: ${domain}`,
  })

  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
  return { ...parsed, sources_checked: [] }
}

// ── Ethical analysis ──────────────────────────────────────────────────────────

export async function getEthicalAnalysis(
  baseUrl: string,
  mainPageText: string,
  onLog: (msg: string) => void,
): Promise<EthicalAnalysis> {
  onLog('Performing ethical analysis...')
  
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: 'You are an ethical business analyst. Return JSON.',
    prompt: `Analyze site content: ${mainPageText.slice(0, 4000)}`,
  })

  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
  return { ...parsed, pages_checked: [] }
}
