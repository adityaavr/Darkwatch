'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Globe } from '@/components/globe'
import type { ScanResult, DetectedPattern, ScanEvent, ProfileComparison, TrustScore, EthicalAnalysis, EthicalConcern, CheckoutAnalysis, VisualDarkPatterns, VisualDarkPattern } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type LogEntry = { time: string; text: string; level: 'info' | 'action' | 'warn' | 'success' }

type ScanJob = {
  id: string
  url: string
  productQuery: string
  status: 'scanning' | 'done' | 'error'
  logs: LogEntry[]
  progress: number
  streamingUrl?: string
  result?: ScanResult
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LIVE_FEED = [
  { site: 'shopify-store.com', pattern: 'Fake countdown timer' },
  { site: 'subscription.app', pattern: 'Hidden charges detected' },
  { site: 'deal-hunter.net', pattern: 'Artificial scarcity' },
  { site: 'flash-sales.co', pattern: 'Price manipulation' },
  { site: 'urgent-deals.org', pattern: 'Pressure tactics' },
  { site: 'checkout-pro.io', pattern: 'Roach motel pattern' },
  { site: 'beauty-shop.com', pattern: 'Fake social proof' },
]

const ACCENT = '#ff4757'
const AMBER = '#f59e0b'
const GREEN = '#10b981'
const BLUE = '#3b82f6'

const LOG_LEVEL_COLORS = { info: '#60a5fa', action: '#a78bfa', warn: '#ff4757', success: '#10b981' }
const LOG_LEVEL_LABELS = { info: 'INFO', action: 'ACT ', warn: 'WARN', success: 'DONE' }

function detectLogLevel(msg: string): LogEntry['level'] {
  if (msg.includes('⚠') || msg.includes('Error') || msg.includes('DETECTED')) return 'warn'
  if (msg.includes('complete') || msg.includes('Analysis complete') || msg.includes('✓')) return 'success'
  if (msg.includes('[TinyFish]') || msg.includes('Navigating') || msg.includes('Searching') || msg.includes('Adding') || msg.includes('Proceeding')) return 'action'
  return 'info'
}

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRiskColor(score: number) {
  if (score >= 60) return ACCENT
  if (score >= 30) return AMBER
  return GREEN
}

// Trust score: high = good (green), low = bad (red) — inverse of risk
function getTrustColor(score: number) {
  if (score >= 70) return GREEN
  if (score >= 40) return AMBER
  return ACCENT
}

function getSeverityColor(severity: string) {
  if (severity === 'critical') return ACCENT
  if (severity === 'medium') return AMBER
  return BLUE
}

function normalizeUrl(input: string) {
  const t = input.trim()
  if (!t.startsWith('http://') && !t.startsWith('https://')) return 'https://' + t
  return t
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

// ── Arc Gauge ─────────────────────────────────────────────────────────────────

function ArcGauge({
  score,
  size = 'lg',
  colorFn = getRiskColor,
  label = 'RISK SCORE',
}: {
  score: number
  size?: 'sm' | 'lg'
  colorFn?: (score: number) => string
  label?: string
}) {
  const color = colorFn(score)
  const r = 68, cx = 100, cy = 100
  // 270° arc: track starts at lower-left (SVG 135°) through top to lower-right (SVG 45°)
  const C = 2 * Math.PI * r         // full circumference ≈ 427.3
  const arcLen = (270 / 360) * C    // 270° visible track ≈ 320.4

  // Mount animation: reveal from 0 to final progress
  const [filled, setFilled] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setFilled((score / 100) * arcLen), 80)
    return () => clearTimeout(t)
  }, [score, arcLen])

  return (
    <div className={size === 'lg' ? 'w-44' : 'w-28'}>
      <svg viewBox="0 0 200 160" className="w-full">
        {/* Background track (270°) */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={size === 'lg' ? 11 : 10}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${C}`}
          transform="rotate(135 100 100)"
        />
        {/* Progress arc */}
        {score > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={size === 'lg' ? 11 : 10}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${C}`}
            transform="rotate(135 100 100)"
            style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1)' }}
          />
        )}
        {/* Score number */}
        <text
          x="100" y="108"
          textAnchor="middle"
          fill={color}
          fontSize={size === 'lg' ? 40 : 30}
          fontWeight="900"
          fontFamily="var(--font-sans), system-ui, sans-serif"
        >
          {score}
        </text>
        {/* Label — only on lg */}
        {size === 'lg' && (
          <text
            x="100" y="124"
            textAnchor="middle"
            fill="#9ca3af"
            fontSize="9"
            letterSpacing="1.5"
            fontFamily="var(--font-mono), monospace"
          >
            {label}
          </text>
        )}
      </svg>
    </div>
  )
}

// ── Extract readable text from HTML snippet ───────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Pattern Card ──────────────────────────────────────────────────────────────

function PatternCard({
  pattern,
  index,
  siteUrl,
}: {
  pattern: DetectedPattern
  index: number
  siteUrl: string
}) {
  const color = getSeverityColor(pattern.severity)
  const [elementTab, setElementTab] = useState<'preview' | 'html'>('preview')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.3 }}
    >
      <Card className="bg-white border-[rgba(0,0,0,0.08)] shadow-none">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="font-semibold text-[#111111] text-sm leading-snug">{pattern.pattern}</span>
            <Badge
              className="shrink-0 text-[10px] font-semibold px-2 py-0.5 border-0"
              style={{ backgroundColor: color + '20', color }}
            >
              {pattern.severity}
            </Badge>
          </div>
          <p className="text-[#6b7280] text-xs mb-3 leading-relaxed">{pattern.explanation}</p>
          <div className="bg-[#fafaf8] border border-[rgba(0,0,0,0.08)] rounded-md p-3 mb-3">
            <span className="text-[10px] text-[#6b7280] font-medium uppercase tracking-wide block mb-1">
              Evidence
            </span>
            <code className="text-xs text-[#111111] font-mono leading-relaxed">
              &ldquo;{pattern.evidence}&rdquo;
            </code>
          </div>

          {/* Element HTML — Preview / HTML toggle */}
          {pattern.element_html && (
            <div className="mb-3">
              <div className="flex items-center gap-1 mb-2">
                <span className="text-[10px] text-[#6b7280] font-medium uppercase tracking-wide flex-1">
                  Element on page
                </span>
                <div className="flex rounded-md overflow-hidden border border-[rgba(0,0,0,0.1)]">
                  {(['preview', 'html'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setElementTab(tab)}
                      className="text-[10px] px-2.5 py-1 font-medium transition-colors"
                      style={{
                        backgroundColor: elementTab === tab ? '#111111' : 'transparent',
                        color: elementTab === tab ? '#ffffff' : '#6b7280',
                      }}
                    >
                      {tab === 'preview' ? 'Preview' : 'HTML'}
                    </button>
                  ))}
                </div>
              </div>

              {elementTab === 'preview' ? (
                <div className="bg-[#fafaf8] border border-[rgba(0,0,0,0.08)] rounded-md p-3">
                  <p className="text-sm text-[#111111] leading-relaxed">
                    {htmlToText(pattern.element_html)}
                  </p>
                </div>
              ) : (
                <pre className="bg-[#fafaf8] border border-[rgba(0,0,0,0.08)] rounded-md p-3 text-[10px] font-mono text-[#6b7280] overflow-auto max-h-36 whitespace-pre-wrap break-all">
                  {pattern.element_html}
                </pre>
              )}
            </div>
          )}

          {/* Link to site — TinyFish will provide specific sub-page URLs */}
          <a
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono hover:underline"
            style={{ color: BLUE }}
          >
            View on site →
          </a>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Bento Scan Card ───────────────────────────────────────────────────────────

function BentoScanCard({
  job,
  selected,
  onClick,
}: {
  job: ScanJob
  selected: boolean
  onClick: () => void
}) {
  const result = job.result
  const isDone = job.status === 'done'
  const isError = job.status === 'error'
  const isScanning = job.status === 'scanning'
  const visibleLogs = job.logs.slice(-5)

  return (
    <Card
      className={`bg-white shadow-none transition-all ${isDone ? 'cursor-pointer' : ''} ${
        selected
          ? 'border-[#111111] ring-1 ring-[rgba(0,0,0,0.12)]'
          : isError
            ? 'border-[#ff4757]/30'
            : 'border-[rgba(0,0,0,0.08)] hover:border-[rgba(0,0,0,0.18)]'
      }`}
      onClick={isDone ? onClick : undefined}
    >
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isScanning && <span className="w-2 h-2 rounded-full bg-[#ff4757] shrink-0 animate-ping" />}
            {isDone && <span className="w-2 h-2 rounded-full bg-[#10b981] shrink-0" />}
            {isError && <span className="w-2 h-2 rounded-full bg-[#ff4757] shrink-0" />}
            <div className="min-w-0">
              <span className="text-sm font-mono text-[#111111] truncate block">{getDomain(job.url)}</span>
              {job.productQuery && (
                <span className="text-[10px] text-[#9ca3af] truncate block">"{job.productQuery}"</span>
              )}
            </div>
          </div>
          {isDone && result && (
            <Badge
              className="text-[10px] font-semibold border-0 shrink-0"
              style={{
                backgroundColor: getRiskColor(result.risk_score) + '18',
                color: getRiskColor(result.risk_score),
              }}
            >
              {result.verdict}
            </Badge>
          )}
          {isScanning && <span className="text-[11px] text-[#6b7280] shrink-0">scanning…</span>}
        </div>

        {/* Scanning: progress + terminal log panel */}
        {isScanning && (
          <>
            <div className="mb-2">
              <Progress value={job.progress} className="h-0.5 bg-[rgba(0,0,0,0.06)]" />
            </div>
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)', minHeight: 100 }}
            >
              <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.05)] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff4757] animate-pulse" />
                <span className="text-[9px] font-mono text-[#374151] tracking-widest">AGENT LOG</span>
              </div>
              <div className="p-3 space-y-1.5">
                <AnimatePresence initial={false}>
                  {visibleLogs.map((log, i) => (
                    <motion.div
                      key={`${job.id}-${job.logs.length - visibleLogs.length + i}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-start gap-2"
                    >
                      <span className="text-[#374151] font-mono text-[9px] shrink-0 mt-px">{log.time}</span>
                      <span
                        className="font-mono text-[9px] shrink-0 font-semibold"
                        style={{ color: LOG_LEVEL_COLORS[log.level] }}
                      >
                        {LOG_LEVEL_LABELS[log.level]}
                      </span>
                      <span className="text-[10px] font-mono leading-relaxed" style={{ color: '#9ca3af' }}>{log.text}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {visibleLogs.length === 0 && (
                  <span className="text-[9px] font-mono text-[#374151]">Initialising...</span>
                )}
              </div>
            </div>
          </>
        )}

        {/* Done: arc gauge + summary */}
        {isDone && result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            <div className="flex justify-center mb-3">
              <ArcGauge score={result.risk_score} size="sm" />
            </div>
            <div className="text-center mb-2 text-sm text-[#6b7280]">
              <span className="font-bold text-[#111111]">{result.patterns.length}</span>{' '}
              pattern{result.patterns.length !== 1 ? 's' : ''} detected
            </div>
            {result.patterns.length > 0 && (
              <div className="flex gap-1 justify-center flex-wrap mb-2">
                {result.patterns.slice(0, 2).map((p, i) => (
                  <span
                    key={i}
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: getSeverityColor(p.severity) + '18',
                      color: getSeverityColor(p.severity),
                    }}
                  >
                    {p.pattern}
                  </span>
                ))}
                {result.patterns.length > 2 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-[rgba(0,0,0,0.05)] text-[#6b7280]">
                    +{result.patterns.length - 2} more
                  </span>
                )}
              </div>
            )}
            <p className="text-center text-[10px] text-[#6b7280] mt-2">
              {selected ? '↑ hide details' : '↓ view details'}
            </p>
          </motion.div>
        )}

        {/* Error */}
        {isError && (
          <p className="text-xs text-[#ff4757] font-mono mt-1">Error: {job.error ?? 'Scan failed'}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Globe Panel (sidebar + mobile) ───────────────────────────────────────────

function GlobePanel({
  jobs,
  isAnyScanning,
  size,
}: {
  jobs: ScanJob[]
  isAnyScanning: boolean
  size: number
}) {
  const totalPatterns = jobs.reduce((n, j) => n + (j.result?.patterns.length ?? 0), 0)
  const doneCount = jobs.filter((j) => j.status === 'done').length

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Globe */}
      <motion.div
        style={{ width: size, height: size }}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 20 }}
      >
        <Globe className="w-full h-full" isScanning={isAnyScanning} />
      </motion.div>

      {/* Status label */}
      <div className="text-center">
        {isAnyScanning ? (
          <div className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ff4757] animate-ping" />
            <span className="text-sm text-[#6b7280] font-medium">Scanning…</span>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm font-semibold text-[#10b981]"
          >
            Analysis complete
          </motion.div>
        )}
        {totalPatterns > 0 && (
          <p className="text-xs text-[#6b7280] mt-1">
            <span className="font-bold" style={{ color: ACCENT }}>
              {totalPatterns}
            </span>{' '}
            pattern{totalPatterns !== 1 ? 's' : ''} found
          </p>
        )}
        {!isAnyScanning && doneCount > 0 && totalPatterns === 0 && (
          <p className="text-xs text-[#10b981] mt-1">No patterns detected</p>
        )}
      </div>

      {/* Per-job status pills */}
      <div className="w-full space-y-1.5">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-[rgba(0,0,0,0.08)] text-xs"
          >
            {job.status === 'scanning' && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4757] animate-ping shrink-0" />
            )}
            {job.status === 'done' && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] shrink-0" />
            )}
            {job.status === 'error' && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4757] shrink-0" />
            )}
            <span className="text-[#6b7280] font-mono truncate flex-1">{getDomain(job.url)}</span>
            {job.status === 'scanning' && (
              <span className="text-[#6b7280] shrink-0 tabular-nums">{job.progress}%</span>
            )}
            {job.result && (
              <span
                className="font-bold shrink-0 tabular-nums"
                style={{ color: getRiskColor(job.result.risk_score) }}
              >
                {job.result.risk_score}
              </span>
            )}
            {job.status === 'error' && (
              <span className="text-[#ff4757] shrink-0">failed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Trust Score Section ───────────────────────────────────────────────────────

function TrustScoreSection({ data }: { data: TrustScore }) {
  const color = getTrustColor(data.trust_score)
  const verdictColors: Record<string, string> = {
    trusted: GREEN,
    caution: AMBER,
    suspicious: ACCENT,
    dangerous: ACCENT,
  }
  const vc = verdictColors[data.verdict] ?? BLUE

  return (
    <div>
      <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-3">
        Trust score
      </h3>
      <Card className="bg-white border-[rgba(0,0,0,0.08)] shadow-none">
        <CardContent className="p-4">
          <div className="flex gap-4 items-start">
            {/* Mini trust gauge */}
            <div className="shrink-0">
              <ArcGauge
                score={data.trust_score}
                size="sm"
                colorFn={getTrustColor}
                label="TRUST"
              />
            </div>
            <div className="flex-1 pt-1">
              <Badge
                className="text-xs font-semibold px-2 py-0.5 border-0 mb-2"
                style={{ backgroundColor: vc + '18', color: vc }}
              >
                {data.verdict.toUpperCase()}
              </Badge>
              {/* Signal bullets */}
              <ul className="space-y-1 mt-2">
                {data.signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-[#6b7280] font-mono text-[10px] mt-px shrink-0">•</span>
                    <span className="text-xs text-[#6b7280] leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
              {/* Sources */}
              <div className="mt-3 flex flex-wrap gap-1">
                {data.sources_checked.map((src, i) => (
                  <span
                    key={i}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#fafaf8] border border-[rgba(0,0,0,0.08)]"
                    style={{ color: src.includes('unavailable') ? '#9ca3af' : color }}
                  >
                    {src.includes('unavailable')
                      ? src.split('/')[2] + ' (blocked)'
                      : '✓ ' + src.split('/')[2]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Price Comparison Section ──────────────────────────────────────────────────

function PriceComparisonSection({ data }: { data: ProfileComparison }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-3">
        Price comparison
      </h3>

      {data.discriminationDetected && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2.5 mb-3 text-sm"
          style={{ backgroundColor: ACCENT + '12', border: `1px solid ${ACCENT}30` }}
        >
          <span style={{ color: ACCENT }} className="shrink-0 mt-px">⚠</span>
          <span className="text-[#111111] text-xs leading-relaxed">
            <strong>Price discrimination detected</strong> — this site shows different prices based
            on your device or location.
          </span>
        </div>
      )}

      <Card className="bg-white border-[rgba(0,0,0,0.08)] shadow-none overflow-hidden">
        <div className="divide-y divide-[rgba(0,0,0,0.06)]">
          {/* Header */}
          <div className="grid grid-cols-3 px-4 py-2 bg-[#fafaf8]">
            <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wide">Profile</span>
            <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wide">Prices seen</span>
            <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wide text-right">Status</span>
          </div>
          {data.profiles.map((p, i) => (
            <div key={i} className="grid grid-cols-3 px-4 py-3 items-center">
              <div>
                <span className="text-xs font-medium text-[#111111]">{p.label}</span>
                {p.baseline && (
                  <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#10b981]/10 text-[#10b981] font-medium">
                    baseline
                  </span>
                )}
              </div>
              <span className="text-xs font-mono text-[#6b7280]">
                {p.prices.length > 0 ? p.prices.slice(0, 4).join(', ') : '—'}
              </span>
              <div className="text-right">
                {p.baseline ? (
                  <span className="text-[10px] font-mono" style={{ color: GREEN }}>✓ baseline</span>
                ) : p.discriminated ? (
                  <span className="text-[10px] font-mono font-semibold" style={{ color: ACCENT }}>⚠ different</span>
                ) : p.prices.length === 0 ? (
                  <span className="text-[10px] font-mono text-[#9ca3af]">no prices</span>
                ) : (
                  <span className="text-[10px] font-mono" style={{ color: GREEN }}>✓ same</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {!data.discriminationDetected && (
        <p className="text-xs text-[#6b7280] mt-2 text-center">
          {data.summary}
        </p>
      )}
    </div>
  )
}

// ── Ethical Analysis Section ──────────────────────────────────────────────────

const ETHICAL_CATEGORY_ICONS: Record<string, string> = {
  'Data Privacy': '🔒',
  'Environmental': '🌍',
  'Labor Practices': '👷',
  'Business Practices': '💼',
  'Transparency': '👁',
  'Consumer Rights': '⚖️',
}

const OVERALL_COLORS: Record<string, string> = {
  concerning: '#ff4757',
  mixed: '#f59e0b',
  acceptable: '#3b82f6',
  good: '#10b981',
}

function EthicalAnalysisSection({ data }: { data: EthicalAnalysis }) {
  const overallColor = OVERALL_COLORS[data.overall] ?? BLUE
  const severityColor = (s: EthicalConcern['severity']) =>
    s === 'high' ? ACCENT : s === 'medium' ? AMBER : BLUE

  return (
    <div>
      <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-3">
        Ethical concerns
      </h3>

      {data.concerns.length === 0 ? (
        <Card className="border-[#10b981]/20 shadow-none bg-[#10b981]/5">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-sm font-semibold text-[#10b981]">No ethical concerns found</p>
              <p className="text-xs text-[#6b7280]">Policy pages and AI analysis returned nothing flagged.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Overall badge */}
          <div className="flex items-center gap-2 mb-3">
            <Badge
              className="text-xs font-semibold px-2.5 py-1 border-0"
              style={{ backgroundColor: overallColor + '18', color: overallColor }}
            >
              {data.overall.toUpperCase()}
            </Badge>
            <span className="text-xs text-[#6b7280]">
              {data.concerns.length} concern{data.concerns.length !== 1 ? 's' : ''} across {[...new Set(data.concerns.map(c => c.category))].length} categor{[...new Set(data.concerns.map(c => c.category))].length !== 1 ? 'ies' : 'y'}
            </span>
            {data.pages_checked.length > 0 && (
              <span className="text-[10px] text-[#9ca3af] ml-auto font-mono">
                {data.pages_checked.length} policy page{data.pages_checked.length !== 1 ? 's' : ''} analysed
              </span>
            )}
          </div>

          {/* Concern cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.concerns.map((c, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i, duration: 0.25 }}
              >
                <Card className="bg-white border-[rgba(0,0,0,0.08)] shadow-none">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="text-base leading-none mt-px">
                        {ETHICAL_CATEGORY_ICONS[c.category] ?? '⚠️'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-[#111111] leading-snug">
                            {c.concern}
                          </span>
                          <Badge
                            className="shrink-0 text-[9px] font-semibold px-1.5 py-0 border-0"
                            style={{
                              backgroundColor: severityColor(c.severity) + '20',
                              color: severityColor(c.severity),
                            }}
                          >
                            {c.severity}
                          </Badge>
                        </div>
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: overallColor }}
                        >
                          {c.category}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-[#6b7280] leading-relaxed pl-6">
                      {c.evidence}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── TinyFish Badge ────────────────────────────────────────────────────────────

function TinyFishBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[#f0f9ff] text-[#0369a1] border border-[#bae6fd]">
      ⚡ TinyFish
    </span>
  )
}

// ── Checkout Analysis Section ─────────────────────────────────────────────────

function CheckoutAnalysisSection({ data }: { data: CheckoutAnalysis }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-3 flex items-center gap-2">
        Checkout analysis <TinyFishBadge />
      </h3>

      {data.hiddenFeesDetected && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2.5 mb-3 text-sm"
          style={{ backgroundColor: ACCENT + '12', border: `1px solid ${ACCENT}30` }}
        >
          <span style={{ color: ACCENT }} className="shrink-0 mt-px">⚠</span>
          <span className="text-[#111111] text-xs leading-relaxed">
            <strong>Hidden fees detected</strong> — product shows {data.productPrice} but checkout total is {data.checkoutTotal}.
          </span>
        </div>
      )}

      <Card className="bg-white border-[rgba(0,0,0,0.08)] shadow-none overflow-hidden">
        <div className="divide-y divide-[rgba(0,0,0,0.06)]">
          {/* Price row */}
          <div className="grid grid-cols-2 px-4 py-3 bg-[#fafaf8]">
            <div>
              <div className="text-[10px] text-[#6b7280] uppercase tracking-wide mb-0.5">Product price</div>
              <div className="text-sm font-mono font-semibold text-[#111111]">{data.productPrice || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6b7280] uppercase tracking-wide mb-0.5">Checkout total</div>
              <div
                className="text-sm font-mono font-semibold"
                style={{ color: data.hiddenFeesDetected ? ACCENT : GREEN }}
              >
                {data.checkoutTotal || '—'}
              </div>
            </div>
          </div>

          {/* Fees */}
          {data.fees.length > 0 && data.fees.map((fee, i) => (
            <div key={i} className="grid grid-cols-2 px-4 py-2.5 items-center">
              <span className="text-xs text-[#374151]">{fee.name}</span>
              <span className="text-xs font-mono text-[#6b7280]">{fee.amount}</span>
            </div>
          ))}

          {/* Pre-checked items */}
          {data.preCheckedItems.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-[10px] text-[#6b7280] uppercase tracking-wide mb-2">Pre-checked add-ons</div>
              <div className="space-y-1">
                {data.preCheckedItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs" style={{ color: AMBER }}>
                    <span>⚠</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-renewal */}
          {data.hasAutoRenewal && (
            <div className="px-4 py-2.5 flex items-center gap-2">
              <span style={{ color: ACCENT }} className="text-xs">⚠</span>
              <span className="text-xs font-medium" style={{ color: ACCENT }}>Auto-renewal subscription detected</span>
            </div>
          )}
        </div>
      </Card>

      {data.summary && (
        <p className="text-xs text-[#6b7280] mt-2">{data.summary}</p>
      )}
    </div>
  )
}

// ── Visual Dark Patterns Section ──────────────────────────────────────────────

function VisualDarkPatternsSection({ data }: { data: VisualDarkPatterns }) {
  if (!data.visualPatterns || data.visualPatterns.length === 0) return null

  return (
    <div>
      <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-3 flex items-center gap-2">
        Visual patterns <TinyFishBadge />
      </h3>

      {data.screenshotObservations && (
        <p className="text-xs text-[#6b7280] mb-3 leading-relaxed">{data.screenshotObservations}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {data.visualPatterns.map((p: VisualDarkPattern, i: number) => {
          const sc = getSeverityColor(p.severity)
          return (
            <Card key={i} className="bg-white border-[rgba(0,0,0,0.08)] shadow-none">
              <CardContent className="p-3">
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="text-base shrink-0">👁</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[#111111]">{p.type}</span>
                      <Badge
                        className="text-[9px] px-1.5 py-0 border-0 font-semibold"
                        style={{ backgroundColor: sc + '18', color: sc }}
                      >
                        {p.severity}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-[#6b7280] leading-relaxed pl-6">{p.description}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Result Detail ─────────────────────────────────────────────────────────────

function ResultDetail({ job }: { job: ScanJob }) {
  const result = job.result!
  const color = getRiskColor(result.risk_score)
  const critical = result.patterns.filter((p) => p.severity === 'critical').length
  const medium = result.patterns.filter((p) => p.severity === 'medium').length
  const low = result.patterns.filter((p) => p.severity === 'low').length

  return (
    <div className="space-y-6">
      {/* Hero row — risk gauge + optional trust gauge + verdict */}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <div className="flex gap-3 items-end shrink-0">
          <ArcGauge score={result.risk_score} size="lg" label="RISK" />
          {result.trustScore && (
            <ArcGauge
              score={result.trustScore.trust_score}
              size="sm"
              colorFn={getTrustColor}
              label="TRUST"
            />
          )}
        </div>
        <div className="flex-1 pt-2">
          <div className="flex items-center gap-2 mb-2">
            <Badge
              className="text-sm font-bold px-3 py-1 border-0"
              style={{ backgroundColor: color + '18', color }}
            >
              {result.verdict.toUpperCase()}
            </Badge>
          </div>
          <p className="text-[#6b7280] text-sm font-mono mb-2">{getDomain(job.url)}</p>
          <p className="text-[#111111] text-sm">
            {result.patterns.length > 0 ? (
              <>
                <span className="font-bold" style={{ color: ACCENT }}>
                  {result.patterns.length}
                </span>{' '}
                dark pattern{result.patterns.length !== 1 ? 's' : ''} detected.
              </>
            ) : (
              'No dark patterns detected — this site appears clean.'
            )}
          </p>
        </div>
      </div>

      {/* Agent trace */}
      <div>
        <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-2">
          Agent trace
        </h3>
        <div className="rounded-xl overflow-hidden" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-4 py-2 border-b border-[rgba(255,255,255,0.05)] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
            <span className="text-[9px] font-mono text-[#374151] tracking-widest">COMPLETED · {job.logs.length} EVENTS</span>
          </div>
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {job.logs.map((log, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[#374151] font-mono text-[10px] shrink-0 mt-px">{log.time}</span>
                <span
                  className="font-mono text-[10px] shrink-0 font-semibold"
                  style={{ color: LOG_LEVEL_COLORS[log.level] }}
                >
                  {LOG_LEVEL_LABELS[log.level]}
                </span>
                <span className="text-[11px] font-mono leading-relaxed" style={{ color: '#9ca3af' }}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Critical', count: critical, color: ACCENT },
          { label: 'Medium', count: medium, color: AMBER },
          { label: 'Low', count: low, color: BLUE },
        ].map(({ label, count, color: c }) => (
          <Card key={label} className="bg-white border-[rgba(0,0,0,0.08)] shadow-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-black mb-1" style={{ color: c }}>
                {count}
              </div>
              <div className="text-xs text-[#6b7280] font-medium">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pattern cards */}
      {result.patterns.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-3">
            Detected patterns
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {result.patterns.map((p, i) => (
              <PatternCard key={i} pattern={p} index={i} siteUrl={job.url} />
            ))}
          </div>
        </div>
      ) : (
        <Card className="border-[#10b981]/20 shadow-none bg-[#10b981]/5">
          <CardContent className="p-8 text-center">
            <div className="text-4xl mb-3">🛡️</div>
            <h3 className="text-lg font-bold text-[#10b981] mb-1">Clean site verified</h3>
            <p className="text-sm text-[#6b7280]">No dark patterns detected in our analysis.</p>
          </CardContent>
        </Card>
      )}

      {/* Trust score */}
      {result.trustScore && <TrustScoreSection data={result.trustScore} />}

      {/* Ethical concerns */}
      {result.ethicalAnalysis && <EthicalAnalysisSection data={result.ethicalAnalysis} />}

      {/* Price comparison */}
      {result.profileComparison && <PriceComparisonSection data={result.profileComparison} />}

      {/* Checkout analysis */}
      {result.checkoutAnalysis && <CheckoutAnalysisSection data={result.checkoutAnalysis} />}

      {/* Visual dark patterns */}
      {result.visualDarkPatterns && <VisualDarkPatternsSection data={result.visualDarkPatterns} />}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Page() {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [urlError, setUrlError] = useState('')
  const [liveFeedIndex, setLiveFeedIndex] = useState(0)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const isActive = jobs.length > 0
  const isAnyScanning = jobs.some((j) => j.status === 'scanning')
  const selectedJob = jobs.find((j) => j.id === selectedJobId)

  // Live feed cycling
  useEffect(() => {
    const id = setInterval(() => setLiveFeedIndex((i) => (i + 1) % LIVE_FEED.length), 2200)
    return () => clearInterval(id)
  }, [])

  // Stream reader
  const startScan = useCallback(
    async (job: ScanJob) => {
      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: job.url, productQuery: job.productQuery }),
        })

        if (!res.ok || !res.body) {
          const err = await res.json()
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id ? { ...j, status: 'error', error: err.error ?? 'Scan failed' } : j,
            ),
          )
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as ScanEvent
              if (event.type === 'log') {
                const entry: LogEntry = { time: nowTime(), text: event.message, level: detectLogLevel(event.message) }
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === job.id ? { ...j, logs: [...j.logs, entry] } : j,
                  ),
                )
              } else if (event.type === 'progress') {
                setJobs((prev) =>
                  prev.map((j) => (j.id === job.id ? { ...j, progress: event.value } : j)),
                )
              } else if (event.type === 'stream_url') {
                setJobs((prev) =>
                  prev.map((j) => (j.id === job.id ? { ...j, streamingUrl: event.url } : j)),
                )
              } else if (event.type === 'result') {
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === job.id
                      ? { ...j, status: 'done', result: event.data, progress: 100 }
                      : j,
                  ),
                )
              } else if (event.type === 'error') {
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === job.id ? { ...j, status: 'error', error: event.message } : j,
                  ),
                )
              }
            } catch {
              // malformed event — skip
            }
          }
        }
      } catch {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id ? { ...j, status: 'error', error: 'Network error' } : j,
          ),
        )
      }
    },
    [],
  )

  const handleScan = useCallback(() => {
    const trimmed = urlInput.trim()
    if (!trimmed) {
      setUrlError('Enter a URL')
      return
    }
    let normalized: string
    try {
      normalized = normalizeUrl(trimmed)
      new URL(normalized)
    } catch {
      setUrlError('Invalid URL')
      return
    }

    setUrlError('')
    setUrlInput('')

    const job: ScanJob = {
      id: crypto.randomUUID(),
      url: normalized,
      productQuery: productQuery.trim(),
      status: 'scanning',
      logs: [],
      progress: 0,
    }
    setJobs((prev) => [...prev, job])
    startScan(job)
  }, [urlInput, productQuery, startScan])

  const handleClear = () => {
    setJobs([])
    setSelectedJobId(null)
    setUrlInput('')
    setProductQuery('')
    setUrlError('')
  }

  const toggleDetail = (jobId: string) => {
    setSelectedJobId((prev) => (prev === jobId ? null : jobId))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence mode="wait">
      {!isActive ? (
        // ── LANDING ──────────────────────────────────────────────────────────
        <motion.div
          key="landing"
          className="min-h-screen bg-[#fafaf8] relative overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.35 }}
        >
          {/* Globe — centered background */}
          <div className="absolute top-[6%] left-1/2 -translate-x-1/2 w-[380px] h-[380px] z-0 opacity-75 pointer-events-none">
            <Globe className="w-full h-full" />
          </div>

          {/* Logo */}
          <div className="absolute top-6 left-8 z-20">
            <span className="text-xl font-bold text-[#111111] tracking-tight">Darkwatch</span>
          </div>

          {/* Hero content */}
          <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 pt-16">
            <div className="text-center mb-8 mt-40">
              <h1 className="text-5xl font-black text-[#111111] leading-tight mb-3">
                Detect dark patterns
                <br />
                <span style={{ color: ACCENT }}>instantly</span>
              </h1>
              <p className="text-[#6b7280] text-lg max-w-md mx-auto">
                AI agent that browses websites like a real user and surfaces every manipulation
                tactic.
              </p>
            </div>

            <div className="w-full max-w-md">
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="example.com"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value)
                    if (urlError) setUrlError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  className={`flex-1 bg-white border-[rgba(0,0,0,0.15)] text-[#111111] placeholder:text-[#6b7280] focus:border-[#111111] ${
                    urlError ? 'border-[#ff4757]' : ''
                  }`}
                />
                <Button
                  onClick={handleScan}
                  className="text-white font-semibold px-6"
                  style={{ backgroundColor: ACCENT }}
                >
                  Scan
                </Button>
              </div>
              <Input
                placeholder="What are you looking for? e.g. Kindle case, running shoes (optional)"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                className="bg-white border-[rgba(0,0,0,0.15)] text-[#111111] placeholder:text-[#9ca3af] focus:border-[#111111] mb-2 text-sm"
              />
              {urlError && <p className="text-xs text-[#ff4757] ml-1">{urlError}</p>}
            </div>
          </div>

          {/* Bottom left — stat pills */}
          <div className="absolute bottom-6 left-8 z-20 flex flex-col gap-1.5">
            {['12,847 scans today', '34,291 patterns caught', '2,156 sites flagged'].map((label) => (
              <div
                key={label}
                className="flex items-center gap-2 bg-white/70 backdrop-blur-sm border border-[rgba(0,0,0,0.08)] rounded-full px-3 py-1"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                <span className="text-xs text-[#6b7280]">{label}</span>
              </div>
            ))}
          </div>

          {/* Bottom right — live detection feed */}
          <div className="absolute bottom-6 right-8 z-20 w-56">
            <div className="text-[10px] text-[#6b7280] uppercase tracking-wide font-medium mb-1.5 text-right">
              Live detections
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={liveFeedIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
                className="bg-white/70 backdrop-blur-sm border border-[rgba(0,0,0,0.08)] rounded-lg px-3 py-2 text-right"
              >
                <div className="text-xs font-mono text-[#111111]">
                  {LIVE_FEED[liveFeedIndex].site}
                </div>
                <div className="text-[11px] font-medium mt-0.5" style={{ color: ACCENT }}>
                  {LIVE_FEED[liveFeedIndex].pattern}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      ) : (
        // ── ACTIVE (bento grid) ───────────────────────────────────────────────
        <motion.div
          key="active"
          className="min-h-screen bg-[#fafaf8]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Compact sticky header — logo + URL input */}
          <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-[rgba(0,0,0,0.08)] z-50">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
              <span className="font-bold text-[#111111] text-base tracking-tight shrink-0">
                Darkwatch
              </span>
              <div className="flex gap-2 ml-auto max-w-sm w-full">
                <div className="flex-1 min-w-0">
                  <Input
                    placeholder="Add another URL…"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value)
                      if (urlError) setUrlError('')
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                    className={`bg-[#fafaf8] border-[rgba(0,0,0,0.15)] text-[#111111] placeholder:text-[#6b7280] h-9 text-sm ${
                      urlError ? 'border-[#ff4757]' : ''
                    }`}
                  />
                </div>
                <Button
                  onClick={handleScan}
                  className="text-white h-9 px-4 text-sm shrink-0"
                  style={{ backgroundColor: ACCENT }}
                >
                  Scan
                </Button>
              </div>
              <Button
                variant="ghost"
                onClick={handleClear}
                className="text-xs text-[#6b7280] hover:text-[#111111] h-9 shrink-0"
              >
                Clear
              </Button>
            </div>
            {urlError && <p className="text-xs text-[#ff4757] px-6 pb-2">{urlError}</p>}
          </div>

          {/* Mobile globe — shown above bento on small screens */}
          <div className="lg:hidden flex flex-col items-center py-6 border-b border-[rgba(0,0,0,0.06)]">
            <GlobePanel jobs={jobs} isAnyScanning={isAnyScanning} size={160} />
          </div>

          {/* Main content: bento grid + sticky globe sidebar */}
          <div className="max-w-6xl mx-auto px-6 py-6 flex gap-8 items-start">
            {/* Left: bento grid */}
            <div className="flex-1 min-w-0">
              <div
                className={`grid gap-4 ${
                  jobs.length === 1
                    ? 'grid-cols-1 max-w-md'
                    : 'grid-cols-1 sm:grid-cols-2'
                }`}
              >
                {jobs.map((job) => (
                  <BentoScanCard
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onClick={() => toggleDetail(job.id)}
                  />
                ))}
              </div>

              {/* Live browser panel — appears when TinyFish streaming URL arrives */}
              <AnimatePresence>
                {jobs.some((j) => j.status === 'scanning' && j.streamingUrl) && (() => {
                  const activeStreamUrl = jobs.find((j) => j.status === 'scanning' && j.streamingUrl)?.streamingUrl
                  return activeStreamUrl ? (
                    <motion.div
                      key="live-browser"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 480 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      className="mt-4 rounded-xl overflow-hidden border border-[rgba(0,0,0,0.08)] bg-[#0a0a0a]"
                    >
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-[rgba(255,255,255,0.06)]">
                        <span className="w-2 h-2 rounded-full bg-[#10b981]" style={{ boxShadow: '0 0 6px #10b981' }} />
                        <span className="text-[10px] font-mono text-[#4b5563] tracking-widest">LIVE BROWSER · AGENT CONTROLLED</span>
                      </div>
                      <iframe
                        src={activeStreamUrl}
                        className="w-full"
                        style={{ height: 446, border: 'none', display: 'block' }}
                        title="TinyFish live browser"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    </motion.div>
                  ) : null
                })()}
              </AnimatePresence>

              {/* Detail panel */}
              <AnimatePresence>
                {selectedJob?.status === 'done' && selectedJob.result && (
                  <motion.div
                    key={selectedJobId}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.3 }}
                    className="mt-6 pt-6 border-t border-[rgba(0,0,0,0.08)]"
                  >
                    <ResultDetail job={selectedJob} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: sticky globe panel — desktop only */}
            <div className="hidden lg:block w-[280px] shrink-0 sticky top-16">
              <GlobePanel jobs={jobs} isAnyScanning={isAnyScanning} size={240} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
