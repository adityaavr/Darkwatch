export type PageSnapshot = {
  url: string
  text_visit_1: string
  text_visit_2: string
  timers_visit_1: string[]
  timers_visit_2: string[]
  social_proof: string[]
  scarcity: string[]
  prices: string[]
  cta_text: string[]
  element_snippets: string[]
}

export type DetectedPattern = {
  pattern: string
  severity: "critical" | "medium" | "low"
  evidence: string
  explanation: string
  element_html?: string
  evidenceScreenshot?: string // base64 data URI screenshot
}

export type ProfileResult = {
  label: string
  prices: string[]
  baseline?: boolean
  discriminated?: boolean
}

export type ProfileComparison = {
  profiles: ProfileResult[]
  discriminationDetected: boolean
  summary: string
}

export type TrustScore = {
  trust_score: number
  verdict: "trusted" | "caution" | "suspicious" | "dangerous"
  sources_checked: string[]
  signals: string[]
  keyQuotes?: string[] // direct verbatim quotes from Reddit posts / reviews
  sourceUrls?: string[] // clickable links to the actual posts / review pages
}

export type EthicalConcern = {
  category:
    | "Data Privacy"
    | "Environmental"
    | "Labor Practices"
    | "Business Practices"
    | "Transparency"
    | "Consumer Rights"
  severity: "high" | "medium" | "low"
  concern: string
  evidence: string
}

export type EthicalAnalysis = {
  overall: "concerning" | "mixed" | "acceptable" | "good"
  concerns: EthicalConcern[]
  pages_checked: string[]
}

export type CheckoutAnalysis = {
  productPrice: string
  checkoutTotal: string
  fees: { name: string; amount: string }[]
  preCheckedItems: string[]
  hasAutoRenewal: boolean
  hiddenFeesDetected: boolean
  summary: string
}

export type VisualDarkPattern = {
  type: string
  description: string
  severity: "critical" | "medium" | "low"
  evidenceScreenshot?: string // base64 data URI of the element
}

export type VisualDarkPatterns = {
  visualPatterns: VisualDarkPattern[]
  screenshotObservations: string
}

// ── Action recommendation ─────────────────────────────────────────────────────

export type ActionVerdict = "safe" | "sketchy" | "skip"

export type ActionRecommendation = {
  verdict: ActionVerdict
  headline: string // e.g. "540% markup on a $2 AliExpress product"
  topFindings: string[] // 2-3 bullet points
  ctaLabel: string // e.g. "Buy direct for $2.50 →"
  ctaUrl?: string // e.g. AliExpress search URL
  ctaSubtext?: string // e.g. "AliExpress · ships to your region"
  evidenceScreenshot?: string // the single most compelling screenshot
  ctaProductImageUrl?: string // product image from scanned site — shown in alt-buy CTA
}

// ── Marketplace price comparison ──────────────────────────────────────────────

export type MarketplaceVerdict =
  | "best-value"
  | "comparable"
  | "premium"
  | "avoid"

export type MarketplaceDataConfidence =
  | "verified-live"
  | "verified-user"
  | "blocked"
  | "unverified"

export type MarketplaceRecoveryAction =
  | "retry-slow"
  | "handoff-human"
  | "switch-source"
  | "defer"

export type MarketplaceRecoveryPlan = {
  marketplace: string
  status: "blocked" | "unverified"
  nextAction: MarketplaceRecoveryAction
  reason: string
  checklist: string[]
  confidence: number // 0-100 planner confidence
}

export type MarketplaceResult = {
  marketplace: string // "Amazon", "ASOS", "Etsy"…
  domain: string // "amazon.com"
  emoji: string // "📦" — rendered without image fetch
  searchUrl: string // direct link to search results page
  topResultName: string // top matching product name (≤50 chars)
  priceRange: string // "$14.99" or "$12–$28"
  rating: string // "4.3★ (1.2k)" or ""
  shippingNote: string // "Free with Prime" or ""
  verdict: MarketplaceVerdict
  verdictReason: string // one sentence
  dataConfidence: MarketplaceDataConfidence
  dataSourceNote: string
  thumbnailUrl?: string // product image URL from Playwright extraction
  productPageUrl?: string // direct product page URL (not search page)
}

export type MarketplaceComparison = {
  results: MarketplaceResult[]
  winner: string // best marketplace name
  summary: string // 1-sentence landscape summary
  currentSiteVerdict: "good-deal" | "fair" | "overpriced"
  currentSiteNote: string // 1-sentence explanation
  recoveryPlans?: MarketplaceRecoveryPlan[]
}

export type WholesaleBenchmarkResult = {
  source: "AliExpress" | "Alibaba"
  price: string
  productTitle: string
  productUrl: string
}

export type WholesaleBenchmark = {
  benchmarks: WholesaleBenchmarkResult[]
  estimatedWholesalePrice: string
  estimatedMarkupPercentage?: string
  summary: string
}

export type SanitizedReceipt = {
  junkFeesStripped: string
  truePrice: string
  trustVerdict: "safe" | "sketchy" | "skip"
}

export type ScanResult = {
  risk_score: number
  verdict: string
  patterns: DetectedPattern[]
  productImageUrl?: string // product thumbnail — shown in result header
  profileComparison?: ProfileComparison
  trustScore?: TrustScore
  ethicalAnalysis?: EthicalAnalysis
  checkoutAnalysis?: CheckoutAnalysis
  visualDarkPatterns?: VisualDarkPatterns
  actionRecommendation?: ActionRecommendation
  marketplaceComparisons?: MarketplaceComparison
  wholesaleBenchmark?: WholesaleBenchmark
  sanitizedReceipt?: SanitizedReceipt
}

export type ScanEvent =
  | { type: "log"; message: string }
  | { type: "progress"; value: number }
  | { type: "stream_url"; url: string; label: string }
  | {
      type: "browser_screenshot"
      dataUrl: string
      label: string
      streamId?: string
    }
  | {
      type: "trust_check"
      source: string
      status: "scanning" | "done" | "failed"
      finding?: string
    }
  | { type: "result"; data: ScanResult }
  | { type: "update"; data: Partial<ScanResult> }
  | { type: "error"; message: string }

// ── Cart Cleanser / Sanitization ─────────────────────────────────────────────

export type JunkFee = {
  name: string
  amount: string
  description: string
  evidenceScreenshot?: string // base64 data URI screenshot of the fee element
}

export type ProductOrigin = {
  isDropshipped: boolean
  wholesalePriceEstimate: string
  markupPercentage: string
  likelySourcedFrom: string
  analysis: string
}

export type SanitizationResult = {
  basePrice: string
  basePriceSource?: "playwright" | "page-analysis" | "ai-web-fallback"
  basePriceConfidence?: "high" | "medium" | "low"
  junkFeesRemoved: JunkFee[]
  finalPrice: string
  screenshotUrl?: string
  productImageUrl?: string // main product image URL from Playwright
  productUrl?: string // the actual product page URL Playwright used (may differ from input)
  trustScore?: number
  fakeReviewsDetected?: boolean
  productOrigin?: ProductOrigin
}

export type CleanCartEvent =
  | {
      type: "log"
      message: string
      level: "info" | "warn" | "action" | "vision" | "success"
    }
  | { type: "stream_url"; url: string }
  | { type: "result"; data: SanitizationResult }
  | { type: "error"; message: string }
