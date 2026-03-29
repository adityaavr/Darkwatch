import OpenAI from 'openai'
import { extractText, extractPrices } from './ai'
import { fetchPagePlain } from './browser'
import type { SanitizationResult } from './types'

// ── Deterministic image extraction — no guessing ──────────────────────────────
// Priority:
//   1. JSON-LD Product schema → image field (most specific, always the product)
//   2. og:image meta tag (set by every platform to the main product image)
//   3. twitter:image meta tag
//   4. null — don't fall back to random <img> tags that are probably logos/banners

function extractProductImage(html: string): string | null {
  // 1. JSON-LD Product schema image
  const jsonldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of jsonldBlocks) {
    try {
      const data = JSON.parse(block[1]) as Record<string, unknown>
      const candidates = Array.isArray(data['@graph'])
        ? (data['@graph'] as Record<string, unknown>[])
        : [data]
      for (const node of candidates) {
        if (!['Product', 'ItemPage', 'WebPage'].includes(node['@type'] as string)) continue
        const img = node.image
        if (typeof img === 'string' && img.startsWith('http')) return img
        if (Array.isArray(img) && typeof img[0] === 'string' && img[0].startsWith('http')) return img[0]
        if (img && typeof (img as Record<string,unknown>).url === 'string') return (img as Record<string,unknown>).url as string
      }
    } catch { /* malformed JSON-LD — skip */ }
  }

  // 2. og:image
  const og =
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i)
  if (og?.[1]?.startsWith('http')) return og[1]

  // 3. twitter:image
  const tw =
    html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/i)
  if (tw?.[1]?.startsWith('http')) return tw[1]

  return null
}

// ── Structured data for GPT-4o context ───────────────────────────────────────

function extractStructuredData(html: string): string {
  const parts: string[] = []

  const jsonld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim()).join('\n')
  if (jsonld) parts.push(`[JSON-LD]\n${jsonld.slice(0, 3000)}`)

  const og = [...html.matchAll(/<meta[^>]*property=["']og:[^"']*["'][^>]*>/gi)]
    .map((m) => m[0]).join('\n')
  if (og) parts.push(`[Open Graph]\n${og}`)

  const priceMeta = [...html.matchAll(/<meta[^>]*(?:name|property)=["'][^"']*(?:price|amount|product)[^"']*["'][^>]*>/gi)]
    .map((m) => m[0]).join('\n')
  if (priceMeta) parts.push(`[Price meta]\n${priceMeta}`)

  return parts.join('\n\n')
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeProductPage(
  url: string,
  query: string,
  onLog: (msg: string) => void,
): Promise<Partial<SanitizationResult>> {
  onLog('Fetching product page HTML...')

  let html = ''
  try {
    html = await fetchPagePlain(url)
    onLog('Page fetched — extracting signals...')
  } catch {
    onLog('Could not fetch page directly — GPT-4o will use domain knowledge')
  }

  // Extract product image deterministically before touching GPT-4o
  const productImageUrl = extractProductImage(html) ?? undefined
  if (productImageUrl) onLog(`Product image found via metadata`)

  const structured = extractStructuredData(html)
  const bodyText = extractText(html).slice(0, 5000)
  const prices = extractPrices(html)
  const domain = new URL(url).hostname.replace('www.', '')

  onLog('GPT-4o analysing product signals...')

  const prompt = `You are DarkWatch, protecting a shopper from junk fees, fake reviews, and dropshipped products sold at massive markups.

Product searched for: "${query}"
Site: ${domain} (${url})

${structured ? `STRUCTURED DATA (JSON-LD / OG tags — most reliable):\n${structured}\n\n` : ''}PRICES DETECTED ON PAGE: ${JSON.stringify(prices)}

PAGE TEXT:
${bodyText || '(page could not be fetched — use your training knowledge about this domain)'}

Return ONLY valid JSON:
{
  "basePrice": "main listed product price e.g. $19.99 — prefer structured data, else parse from text, else null",
  "trustScore": <integer 0-100: 85+=genuine brand with real reviews, 50-84=mixed signals, 0-49=fake/suspicious>,
  "fakeReviewsDetected": <true if review manipulation signals present, false otherwise>,
  "productOrigin": {
    "isDropshipped": <true if AliExpress/Alibaba wholesale signals present>,
    "wholesalePriceEstimate": "e.g. $2.50 or N/A",
    "markupPercentage": "e.g. 700% or N/A",
    "likelySourcedFrom": "e.g. AliExpress / Alibaba or Legitimate branded product",
    "analysis": "2-3 sentences citing specific signals: title style, price, review patterns, brand info, or your knowledge of this domain"
  }
}

DROPSHIP SIGNALS: generic unbranded title, very low price, no manufacturer info, AliExpress-style description
FAKE REVIEW SIGNALS: incentive disclosures, identical phrasing, all 5-star, date clustering, new accounts
If page is empty, use your training knowledge about "${domain}".`

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 500,
  })

  type Parsed = {
    basePrice?: string | null
    trustScore?: number
    fakeReviewsDetected?: boolean
    productOrigin?: SanitizationResult['productOrigin']
  }
  const parsed = JSON.parse(res.choices[0].message.content!) as Parsed
  const isDropshipped = parsed.productOrigin?.isDropshipped ?? false

  onLog(`Analysis done — ${isDropshipped ? '⚠ dropship signals detected' : '✓ appears legitimate'} · trust ${parsed.trustScore ?? '?'}/100`)

  return {
    basePrice: parsed.basePrice ?? 'unknown',
    finalPrice: parsed.basePrice ?? 'unknown',
    productImageUrl,          // from og:image / JSON-LD — not GPT-4o guessing
    trustScore: parsed.trustScore,
    fakeReviewsDetected: parsed.fakeReviewsDetected ?? false,
    productOrigin: parsed.productOrigin,
    junkFeesRemoved: [],
  }
}
