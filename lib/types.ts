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

export type ScanResult = {
  risk_score: number
  verdict: string
  patterns: DetectedPattern[]
  profileComparison?: ProfileComparison
  trustScore?: TrustScore
  ethicalAnalysis?: EthicalAnalysis
}

export type ScanEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; value: number }
  | { type: 'result'; data: ScanResult }
  | { type: 'error'; message: string }
