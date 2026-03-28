// ── Shared Types ─────────────────────────────────────────────────────────────

export interface JunkFee {
  name: string
  amount: string
  description: string
}

export interface SanitizationResult {
  basePrice: string
  junkFeesRemoved: JunkFee[]
  finalPrice: string
  screenshotUrl?: string
  trustScore?: number
  fakeReviewsDetected?: boolean
  productOrigin?: {
    isDropshipped: boolean
    wholesalePriceEstimate: string
    markupPercentage: string
    likelySourcedFrom: string
    analysis: string
  }
  actionRecommendation?: ActionRecommendation
}

// ── Legacy/Detailed Scanner Types ───────────────────────────────────────────

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
}

export type ProfileResult = {
  label: string
  prices: string[]
  baseline: boolean
  discriminated?: boolean
}

export type LogEntry = {
  id: string
  time: string
  text: string
  level: "info" | "action" | "warn" | "success" | "vision"
}

export type ProfileComparison = {
  profiles: ProfileResult[]
  discriminationDetected: boolean
  summary: string
}

export type TrustScore = {
  trust_score: number
  verdict: "trusted" | "caution" | "suspicious" | "dangerous"
  signals: string[]
  sources_checked: string[]
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
}

export type ScanResult = {
  risk_score: number
  verdict: "clean" | "low risk" | "medium risk" | "high risk" | "critical"
  patterns: DetectedPattern[]
  profileComparison?: ProfileComparison
  trustScore?: TrustScore
  ethicalAnalysis?: EthicalAnalysis
  checkoutAnalysis?: CheckoutAnalysis
  visualDarkPatterns?: VisualDarkPatterns
  actionRecommendation?: ActionRecommendation
}

export type ScanEvent =
  | { type: "log"; message: string }
  | { type: "progress"; value: number }
  | { type: "stream_url"; url: string }
  | { type: "result"; data: ScanResult }
  | { type: "error"; message: string }
  | { type: "HEARTBEAT" }
  | { type: "STREAMING_URL"; url: string }
  | { type: "ACTION"; action: string; selector?: string; text?: string }
  | { type: "COMPLETE"; status: string; resultJson?: any }
