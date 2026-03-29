import OpenAI from "openai"

type PriceFallbackResult = {
  price: string | null
  sourceUrl?: string
  confidence: "high" | "medium" | "low"
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePrice(raw: string): string | null {
  const m = raw.match(/[$£€]\s*[\d,.]+(?:\.\d{1,2})?/)
  if (!m) return null
  return m[0].replace(/\s+/g, "")
}

function extractSearchUrls(html: string, domain: string): string[] {
  const out: string[] = []
  const direct = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"#]+)"/gi)].map(
    (m) => m[1]
  )
  const ddg = [
    ...html.matchAll(/href="\/l\/\?[^"#]*uddg=([^"&]+)[^"#]*"/gi),
  ].map((m) => {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return ""
    }
  })

  for (const url of [...direct, ...ddg]) {
    if (!url) continue
    try {
      const u = new URL(url)
      const h = u.hostname.replace(/^www\./, "")
      if (!h.includes(domain)) continue
      out.push(url)
    } catch {
      // skip invalid
    }
  }
  return [...new Set(out)].slice(0, 3)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  })
  return await res.text()
}

export async function resolvePriceWithAiWebFallback(
  query: string,
  domain: string,
  onLog: (msg: string) => void
): Promise<PriceFallbackResult> {
  try {
    onLog(`Price fallback: searching web evidence for ${domain}...`)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${domain} ${query} price`)}`
    const searchHtml = await fetchText(searchUrl)
    const urls = extractSearchUrls(searchHtml, domain)
    if (urls.length === 0) {
      return { price: null, confidence: "low" }
    }

    const pages = await Promise.allSettled(urls.map((u) => fetchText(u)))
    const evidence = pages
      .map((p, i) => {
        if (p.status !== "fulfilled") return ""
        const txt = stripHtml(p.value).slice(0, 2200)
        return `URL: ${urls[i]}\nTEXT: ${txt}`
      })
      .filter(Boolean)

    if (evidence.length === 0) {
      return { price: null, confidence: "low" }
    }

    if (!process.env.OPENAI_API_KEY) {
      for (let i = 0; i < evidence.length; i++) {
        const p = normalizePrice(evidence[i])
        if (p) return { price: p, sourceUrl: urls[i], confidence: "low" }
      }
      return { price: null, confidence: "low" }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const prompt = `Find the most likely current product price for this exact item from this merchant domain.

Query: ${query}
Domain: ${domain}

Evidence:
${evidence.join("\n\n---\n\n")}

Rules:
- Return a price only if clearly tied to the product evidence.
- Prefer exact product pages over generic category pages.
- If uncertain, return null.

Return strict JSON only:
{
  "price": "$0.00 or null",
  "sourceUrl": "https://... or null",
  "confidence": "high|medium|low"
}`

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 220,
    })

    const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as {
      price?: string | null
      sourceUrl?: string | null
      confidence?: "high" | "medium" | "low"
    }

    const normalized = parsed.price ? normalizePrice(parsed.price) : null
    if (!normalized) return { price: null, confidence: "low" }
    return {
      price: normalized,
      sourceUrl: parsed.sourceUrl ?? undefined,
      confidence: parsed.confidence ?? "medium",
    }
  } catch {
    return { price: null, confidence: "low" }
  }
}
