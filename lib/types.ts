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
  element_snippets: string[]  // raw HTML elements likely to contain dark patterns
}

export type DetectedPattern = {
  pattern: string
  severity: 'critical' | 'medium' | 'low'
  evidence: string
  explanation: string
  element_html?: string   // actual HTML element from the page containing the evidence
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
  verdict: 'trusted' | 'caution' | 'suspicious' | 'dangerous'
  sources_checked: string[]
  signals: string[]
}

export type EthicalConcern = {
  category: 'Data Privacy' | 'Environmental' | 'Labor Practices' | 'Business Practices' | 'Transparency' | 'Consumer Rights'
  severity: 'high' | 'medium' | 'low'
  concern: string       // one-line title
  evidence: string      // specific evidence or reasoning
}

export type EthicalAnalysis = {
  overall: 'concerning' | 'mixed' | 'acceptable' | 'good'
  concerns: EthicalConcern[]
  pages_checked: string[]  // which policy pages were successfully fetched
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
  severity: 'critical' | 'medium' | 'low'
}

export type VisualDarkPatterns = {
  visualPatterns: VisualDarkPattern[]
  screenshotObservations: string
}

export type ScanResult = {
  risk_score: number
  verdict: string
  patterns: DetectedPattern[]
  profileComparison?: ProfileComparison
  trustScore?: TrustScore
  ethicalAnalysis?: EthicalAnalysis
  checkoutAnalysis?: CheckoutAnalysis
  visualDarkPatterns?: VisualDarkPatterns
}

export type ScanEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; value: number }
  | { type: 'stream_url'; url: string }
  | { type: 'result'; data: ScanResult }
  | { type: 'error'; message: string }

// ── Cart Cleanser (v3) ────────────────────────────────────────────────────────

export type FeeItem = {
  name: string
  amount: string
  stripped: boolean
}

export type CartResult = {
  productName: string
  basePrice: string
  originalCartTotal: string
  sanitizedTotal: string
  feesStripped: FeeItem[]
  savings: string
  success: boolean
}

export type CleanCartEvent =
  | { type: 'log'; message: string; level: 'info' | 'warn' | 'action' | 'vision' | 'success' }
  | { type: 'stream_url'; url: string }
  | { type: 'result'; data: CartResult }
  | { type: 'error'; message: string }
