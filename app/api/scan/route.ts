import { NextRequest } from "next/server"
import { cleanCart } from "@/lib/tinyfish-service"
import { getVisualDarkPatterns } from "@/lib/browser"
import { synthesiseAction, getTrustScore, getEthicalAnalysis } from "@/lib/ai"
import { compareMarketplaces } from "@/lib/marketplace-comparison"
import { compareWholesaleBenchmarks } from "@/lib/wholesale-benchmark"
import type { ScanResult, ScanEvent } from "@/lib/types"
import type { SanitizationResult } from "@/lib/types"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "OPENAI_API_KEY is missing on this deployment environment. Add it to the active Vercel environment and redeploy.",
        vercelEnv: process.env.VERCEL_ENV ?? null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }

  const { url, productQuery } = await req.json()

  if (!url || typeof url !== "string") {
    return new Response(JSON.stringify({ error: "url is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  let normalizedUrl = url.trim()
  if (
    !normalizedUrl.startsWith("http://") &&
    !normalizedUrl.startsWith("https://")
  ) {
    normalizedUrl = "https://" + normalizedUrl
  }
  try {
    new URL(normalizedUrl)
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const query: string =
    typeof productQuery === "string" && productQuery.trim()
      ? productQuery.trim()
      : "product"

  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()

  const send = (event: ScanEvent) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  }

  ;(async () => {
    try {
      send({ type: "progress", value: 5 })

      const domain = new URL(normalizedUrl).hostname.replace("www.", "")
      send({ type: "log", message: `Scanning ${domain}...` })

      // ── Background tasks — fire immediately, never block the main result ──

      const trustPromise = getTrustScore(
        domain,
        (msg) => send({ type: "log", message: msg }),
        (streamUrl) =>
          send({
            type: "stream_url",
            url: streamUrl,
            label: "🔍 REDDIT AGENT · Community Reviews",
          }),
        (source, status, finding) =>
          send({ type: "trust_check", source, status, finding }),
        query, // product-aware Reddit search
        (dataUrl, label, streamId) =>
          send({ type: "browser_screenshot", dataUrl, label, streamId })
      ).catch(() => null)

      send({
        type: "trust_check",
        source: "Ethics · Privacy",
        status: "scanning",
      })
      send({
        type: "trust_check",
        source: "Ethics · Labor",
        status: "scanning",
      })
      send({
        type: "trust_check",
        source: "Ethics · Environment",
        status: "scanning",
      })

      const ethicsPromise = getEthicalAnalysis(normalizedUrl, "", (msg) =>
        send({ type: "log", message: msg })
      )
        .then((result) => {
          const severity = (kw: string) => {
            const c = result.concerns.find((c) =>
              c.category.toLowerCase().includes(kw)
            )
            return c ? `${c.severity} severity concern` : undefined
          }
          send({
            type: "trust_check",
            source: "Ethics · Privacy",
            status: "done",
            finding: severity("privacy") ?? "no concerns found",
          })
          send({
            type: "trust_check",
            source: "Ethics · Labor",
            status: "done",
            finding: severity("labor") ?? "no concerns found",
          })
          send({
            type: "trust_check",
            source: "Ethics · Environment",
            status: "done",
            finding: severity("environ") ?? "no concerns found",
          })
          return result
        })
        .catch(() => {
          send({
            type: "trust_check",
            source: "Ethics · Privacy",
            status: "failed",
          })
          send({
            type: "trust_check",
            source: "Ethics · Labor",
            status: "failed",
          })
          send({
            type: "trust_check",
            source: "Ethics · Environment",
            status: "failed",
          })
          return null
        })

      // ── Main scan: cart agent ─────────────────────────────────────────────
      const sanitization = await cleanCart(
        normalizedUrl,
        query,
        (message) => send({ type: "log", message }),
        (streamUrl) =>
          send({
            type: "stream_url",
            url: streamUrl,
            label: `🛒 CART AGENT · ${domain}`,
          }),
        (dataUrl) =>
          send({
            type: "browser_screenshot",
            dataUrl,
            label: `🔴 LIVE · ${domain}`,
            streamId: "cart-agent",
          })
      )

      // ── Marketplace comparison — needs currentPrice from cleanCart ───────────
      const currentPrice = sanitization.basePrice ?? ""
      const marketplacePromise = compareMarketplaces(
        query,
        domain,
        currentPrice,
        (msg) => send({ type: "log", message: msg }),
        (dataUrl, label, streamId) =>
          send({ type: "browser_screenshot", dataUrl, label, streamId })
      ).catch(() => null)

      const wholesalePromise = compareWholesaleBenchmarks(
        query,
        currentPrice,
        (msg) => send({ type: "log", message: msg })
      ).catch(() => null)

      // Visual evidence — fires AFTER cleanCart so we use the actual product URL
      // (not the homepage the user typed). Runs in background with 180s ceiling.
      const productPageUrl = sanitization.productUrl ?? normalizedUrl
      const visualPromise = getVisualDarkPatterns(productPageUrl, (msg) =>
        send({ type: "log", message: msg })
      ).catch(() => null)

      send({ type: "progress", value: 80 })

      // ── GPT-4o synthesis ─────────────────────────────────────────────────
      const baseScanResult = buildScanResult(sanitization)

      try {
        baseScanResult.actionRecommendation = await synthesiseAction(
          sanitization,
          query,
          (msg) => send({ type: "log", message: msg })
        )
        if (baseScanResult.sanitizedReceipt) {
          baseScanResult.sanitizedReceipt.trustVerdict =
            baseScanResult.actionRecommendation.verdict
        }
      } catch {
        send({
          type: "log",
          message: "AI synthesis unavailable — using rule-based verdict",
        })
        baseScanResult.actionRecommendation = fallbackRec(sanitization, query)
        if (baseScanResult.sanitizedReceipt) {
          baseScanResult.sanitizedReceipt.trustVerdict =
            baseScanResult.actionRecommendation.verdict
        }
      }

      // ── Stream result now — user sees verdict immediately ─────────────────
      send({ type: "progress", value: 100 })
      send({ type: "result", data: baseScanResult })

      // ── Patch in background results AS EACH ONE FINISHES ─────────────────
      // Critical: each .then() fires individually — trust/ethics arrive in
      // seconds without waiting for slow background tasks.
      const DEADLINE = 180_000
      const addDeadline = <T>(p: Promise<T | null>) =>
        Promise.race([
          p,
          new Promise<null>((r) => setTimeout(() => r(null), DEADLINE)),
        ])

      trustPromise
        .then((r) => {
          if (!r) return
          send({
            type: "log",
            message: `Trust check complete — ${r.verdict} (${r.trust_score}/100)`,
          })
          send({ type: "update", data: { trustScore: r } })
        })
        .catch(() => null)

      ethicsPromise
        .then((r) => {
          if (!r) return
          const n = r.concerns.length
          send({
            type: "log",
            message: `Ethics scan complete — ${n} concern${n !== 1 ? "s" : ""} (${r.overall})`,
          })
          send({ type: "update", data: { ethicalAnalysis: r } })
        })
        .catch(() => null)

      visualPromise
        .then((r) => {
          if (!r || !r.visualPatterns?.length) return
          const withShots = r.visualPatterns.filter(
            (p) => p.evidenceScreenshot
          ).length
          send({
            type: "log",
            message: `Visual evidence: ${r.visualPatterns.length} pattern(s), ${withShots} screenshot(s)`,
          })
          send({ type: "update", data: { visualDarkPatterns: r } })
        })
        .catch(() => null)

      marketplacePromise
        .then((r) => {
          if (!r) return
          const verdict =
            r.currentSiteVerdict === "overpriced"
              ? "⚠ overpriced"
              : r.currentSiteVerdict === "fair"
                ? "fair price"
                : "✓ good deal"
          send({
            type: "log",
            message: `Price comparison: ${r.winner} is best value · ${domain} is ${verdict}`,
          })
          send({ type: "update", data: { marketplaceComparisons: r } })
        })
        .catch(() => null)

      wholesalePromise
        .then((r) => {
          if (!r) return
          send({ type: "log", message: `Wholesale map: ${r.summary}` })
          send({ type: "update", data: { wholesaleBenchmark: r } })
        })
        .catch(() => null)

      // Wait for all (or their deadlines) before closing the stream
      await Promise.all([
        addDeadline(trustPromise),
        addDeadline(ethicsPromise),
        addDeadline(visualPromise),
        addDeadline(marketplacePromise),
        addDeadline(wholesalePromise),
      ])
    } catch (err) {
      send({
        type: "error",
        message: err instanceof Error ? err.message : "Scan failed",
      })
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

// ── Build ScanResult from SanitizationResult ──────────────────────────────────

function buildScanResult(s: SanitizationResult): ScanResult {
  const fees = s.junkFeesRemoved ?? []
  const totalSaved = fees.reduce(
    (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, "") || "0"),
    0
  )

  const riskScore = Math.min(
    98,
    fees.length * 20 +
      (s.fakeReviewsDetected ? 20 : 0) +
      (s.productOrigin?.isDropshipped ? 15 : 0)
  )

  const verdict: ScanResult["verdict"] =
    riskScore >= 60
      ? "high risk"
      : riskScore >= 35
        ? "medium risk"
        : riskScore >= 10
          ? "low risk"
          : "clean"

  return {
    risk_score: riskScore,
    verdict,
    productImageUrl: s.productImageUrl, // ← now flows through to the UI
    sanitizedReceipt: {
      junkFeesStripped: `$${totalSaved.toFixed(2)}`,
      truePrice: s.finalPrice,
      trustVerdict:
        riskScore >= 60 ? "skip" : riskScore >= 35 ? "sketchy" : "safe",
    },
    patterns: fees.map((f) => ({
      pattern: f.name,
      severity: "critical" as const,
      evidence: f.amount,
      explanation: f.description,
      evidenceScreenshot: f.evidenceScreenshot,
    })),
    trustScore:
      s.trustScore != null
        ? {
            trust_score: s.trustScore,
            verdict:
              s.trustScore >= 70
                ? "trusted"
                : s.trustScore >= 45
                  ? "caution"
                  : s.trustScore >= 25
                    ? "suspicious"
                    : "dangerous",
            signals: s.fakeReviewsDetected
              ? ["Fake or incentivised reviews detected on the product page"]
              : ["On-page reviews appear genuine — no fake signals detected"],
            sources_checked: ["Product page (GPT-4o analysis)"],
          }
        : undefined,
  }
}

// ── Alternative marketplace selector ──────────────────────────────────────────
// Picks the most relevant marketplace based on query keywords.
// Used as fallback when GPT-4o synthesis is unavailable.

function pickAlternativeMarketplace(query: string): {
  url: string
  subtext: string
} {
  const q = query.toLowerCase()
  const encoded = encodeURIComponent(query)

  // Handmade / jewellery / art → Etsy
  if (
    /jewel|jewel|necklace|ring|bracelet|earring|handmade|craft|vintage|art print|poster/.test(
      q
    )
  ) {
    return {
      url: `https://www.etsy.com/search?q=${encoded}`,
      subtext: "Etsy · handmade & independent sellers",
    }
  }
  // Home goods / furniture → Wayfair
  if (
    /furniture|sofa|couch|desk|chair|bed|mattress|rug|lamp|curtain|shelf|cabinet/.test(
      q
    )
  ) {
    return {
      url: `https://www.wayfair.com/keyword.php?keyword=${encoded}`,
      subtext: "Wayfair · no hidden fees, free shipping",
    }
  }
  // Budget fashion / low-price apparel → Temu
  if (
    /dress|shirt|blouse|jeans|legging|swimwear|bikini|hoodie|jacket|coat|shoes|sneaker|sandal/.test(
      q
    )
  ) {
    return {
      url: `https://www.temu.com/search_result.html?search_key=${encoded}`,
      subtext: "Temu · same item, fraction of the price",
    }
  }
  // Electronics → Amazon
  if (
    /phone|laptop|tablet|headphone|earbuds|keyboard|mouse|monitor|camera|speaker|charger|cable|watch/.test(
      q
    )
  ) {
    return {
      url: `https://www.amazon.com/s?k=${encoded}`,
      subtext: "Amazon · fast shipping, buyer protection",
    }
  }
  // Default → Amazon
  return {
    url: `https://www.amazon.com/s?k=${encoded}`,
    subtext: "Amazon · compare prices & reviews",
  }
}

// ── Rule-based fallback ────────────────────────────────────────────────────────

function fallbackRec(s: SanitizationResult, query: string) {
  const fees = s.junkFeesRemoved ?? []
  const isDropshipped = s.productOrigin?.isDropshipped ?? false
  const wholesale = s.productOrigin?.wholesalePriceEstimate ?? ""
  const markup = s.productOrigin?.markupPercentage ?? ""
  const totalSaved = fees.reduce(
    (sum, f) => sum + parseFloat(f.amount.replace(/[^0-9.]/g, "") || "0"),
    0
  )

  const verdict =
    fees.length > 0 && isDropshipped
      ? "skip"
      : fees.length > 0 || isDropshipped || s.fakeReviewsDetected
        ? "sketchy"
        : "safe"

  const findings: string[] = []
  if (fees.length > 0)
    findings.push(
      `${fees.length} junk fee${fees.length > 1 ? "s" : ""} — $${totalSaved.toFixed(2)} stripped`
    )
  if (isDropshipped && markup)
    findings.push(`${markup} markup on a ~${wholesale} wholesale product`)
  if (s.fakeReviewsDetected)
    findings.push("Fake or incentivised reviews detected")

  const alt = isDropshipped ? pickAlternativeMarketplace(query) : null

  return {
    verdict: verdict as "safe" | "sketchy" | "skip",
    headline:
      isDropshipped && markup
        ? `${markup} markup — buy direct for ${wholesale}`
        : fees.length > 0
          ? `$${totalSaved.toFixed(2)} in junk fees stripped`
          : `No hidden fees detected`,
    topFindings:
      findings.length > 0
        ? findings.slice(0, 3)
        : ["No hidden fees or dark patterns found"],
    ctaLabel:
      alt && wholesale
        ? `Buy direct for ${wholesale} →`
        : `True price: ${s.finalPrice}`,
    ctaUrl: alt?.url ?? undefined,
    ctaSubtext: alt?.subtext ?? undefined,
    ctaProductImageUrl: s.productImageUrl, // ← always attach image to CTA
  }
}
