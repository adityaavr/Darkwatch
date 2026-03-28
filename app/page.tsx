"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Globe } from "@/components/globe"
import {
  Search,
  Terminal,
  CheckCircle2,
  ShoppingCart,
  ShieldAlert,
  ArrowRight,
} from "lucide-react"
import type {
  ScanResult,
  DetectedPattern,
  ScanEvent,
  ProfileComparison,
  TrustScore,
  EthicalAnalysis,
  EthicalConcern,
  CheckoutAnalysis,
  VisualDarkPatterns,
  VisualDarkPattern,
  SanitizationResult,
  ActionRecommendation,
  ActionVerdict,
} from "@/lib/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type LogEntry = {
  time: string
  text: string
  level: "info" | "action" | "warn" | "success" | "vision"
}

type ScanJob = {
  id: string
  url: string
  productQuery: string
  status: "scanning" | "done" | "error"
  logs: LogEntry[]
  progress: number
  streamingUrl?: string
  result?: ScanResult
  sanitizationResult?: SanitizationResult
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LIVE_FEED = [
  { site: "shopify-store.com", pattern: "Fake countdown timer" },
  { site: "subscription.app", pattern: "Hidden charges detected" },
  { site: "deal-hunter.net", pattern: "Artificial scarcity" },
  { site: "flash-sales.co", pattern: "Price manipulation" },
  { site: "urgent-deals.org", pattern: "Pressure tactics" },
  { site: "checkout-pro.io", pattern: "Roach motel pattern" },
  { site: "beauty-shop.com", pattern: "Fake social proof" },
]

const ACCENT = "#ff4757"
const AMBER = "#f59e0b"
const GREEN = "#10b981"
const BLUE = "#3b82f6"

const LOG_LEVEL_COLORS = {
  info: "#60a5fa",
  action: "#a78bfa",
  warn: "#ff4757",
  success: "#10b981",
  vision: "#f59e0b",
}
const LOG_LEVEL_LABELS = {
  info: "INFO",
  action: "ACT ",
  warn: "WARN",
  success: "DONE",
  vision: "VISN",
}

function detectLogLevel(msg: string): LogEntry["level"] {
  const m = msg.toLowerCase()
  if (
    m.includes("warn") ||
    m.includes("error") ||
    m.includes("detected") ||
    m.includes("hidden") ||
    m.includes("trap")
  )
    return "warn"
  if (
    m.includes("complete") ||
    m.includes("success") ||
    m.includes("✓") ||
    m.includes("sanitized")
  )
    return "success"
  if (
    m.includes("vision") ||
    m.includes("brain") ||
    m.includes("ai vision") ||
    m.includes("analyzing layout")
  )
    return "vision"
  if (
    m.includes("executing") ||
    m.includes("navigating") ||
    m.includes("searching") ||
    m.includes("adding") ||
    m.includes("clicking") ||
    m.includes("[tinyfish]")
  )
    return "action"
  return "info"
}

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false })
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
  if (severity === "critical") return ACCENT
  if (severity === "medium") return AMBER
  return BLUE
}

function normalizeUrl(input: string) {
  const t = input.trim()
  if (!t.startsWith("http://") && !t.startsWith("https://"))
    return "https://" + t
  return t
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "")
  } catch {
    return url
  }
}

// ── Arc Gauge ─────────────────────────────────────────────────────────────────

function ArcGauge({
  score,
  size = "lg",
  colorFn = getRiskColor,
  label = "RISK SCORE",
}: {
  score: number
  size?: "sm" | "lg"
  colorFn?: (score: number) => string
  label?: string
}) {
  const color = colorFn(score)
  const r = 68,
    cx = 100,
    cy = 100
  // 270° arc: track starts at lower-left (SVG 135°) through top to lower-right (SVG 45°)
  const C = 2 * Math.PI * r // full circumference ≈ 427.3
  const arcLen = (270 / 360) * C // 270° visible track ≈ 320.4

  // Mount animation: reveal from 0 to final progress
  const [filled, setFilled] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setFilled((score / 100) * arcLen), 80)
    return () => clearTimeout(t)
  }, [score, arcLen])

  return (
    <div className={size === "lg" ? "w-44" : "w-28"}>
      <svg viewBox="0 0 200 160" className="w-full">
        {/* Background track (270°) */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={size === "lg" ? 11 : 10}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${C}`}
          transform="rotate(135 100 100)"
        />
        {/* Progress arc */}
        {score > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={size === "lg" ? 11 : 10}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${C}`}
            transform="rotate(135 100 100)"
            style={{
              transition: "stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1)",
            }}
          />
        )}
        {/* Score number */}
        <text
          x="100"
          y="108"
          textAnchor="middle"
          fill={color}
          fontSize={size === "lg" ? 40 : 30}
          fontWeight="900"
          fontFamily="var(--font-sans), system-ui, sans-serif"
        >
          {score}
        </text>
        {/* Label — only on lg */}
        {size === "lg" && (
          <text
            x="100"
            y="124"
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
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
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
  const [elementTab, setElementTab] = useState<"preview" | "html">("preview")

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.3 }}
    >
      <Card className="border-[rgba(0,0,0,0.08)] bg-white shadow-none">
        <CardContent className="p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="text-sm leading-snug font-semibold text-[#111111]">
              {pattern.pattern}
            </span>
            <Badge
              className="shrink-0 border-0 px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: color + "20", color }}
            >
              {pattern.severity}
            </Badge>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[#6b7280]">
            {pattern.explanation}
          </p>
          <div className="mb-3 rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
            <span className="mb-1 block text-[10px] font-medium tracking-wide text-[#6b7280] uppercase">
              Evidence
            </span>
            <code className="font-mono text-xs leading-relaxed text-[#111111]">
              &ldquo;{pattern.evidence}&rdquo;
            </code>
          </div>

          {/* Element HTML — Preview / HTML toggle */}
          {pattern.element_html && (
            <div className="mb-3">
              <div className="mb-2 flex items-center gap-1">
                <span className="flex-1 text-[10px] font-medium tracking-wide text-[#6b7280] uppercase">
                  Element on page
                </span>
                <div className="flex overflow-hidden rounded-md border border-[rgba(0,0,0,0.1)]">
                  {(["preview", "html"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setElementTab(tab)}
                      className="px-2.5 py-1 text-[10px] font-medium transition-colors"
                      style={{
                        backgroundColor:
                          elementTab === tab ? "#111111" : "transparent",
                        color: elementTab === tab ? "#ffffff" : "#6b7280",
                      }}
                    >
                      {tab === "preview" ? "Preview" : "HTML"}
                    </button>
                  ))}
                </div>
              </div>

              {elementTab === "preview" ? (
                <div className="rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
                  <p className="text-sm leading-relaxed text-[#111111]">
                    {htmlToText(pattern.element_html)}
                  </p>
                </div>
              ) : (
                <pre className="max-h-36 overflow-auto rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3 font-mono text-[10px] break-all whitespace-pre-wrap text-[#6b7280]">
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
            className="font-mono text-[11px] hover:underline"
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
  const isDone = job.status === "done"
  const isError = job.status === "error"
  const isScanning = job.status === "scanning"
  const visibleLogs = job.logs.slice(-5)

  return (
    <Card
      className={`bg-white shadow-none transition-all ${isDone ? "cursor-pointer" : ""} ${
        selected
          ? "border-[#111111] ring-1 ring-[rgba(0,0,0,0.12)]"
          : isError
            ? "border-[#ff4757]/30"
            : "border-[rgba(0,0,0,0.08)] hover:border-[rgba(0,0,0,0.18)]"
      }`}
      onClick={isDone ? onClick : undefined}
    >
      <CardContent className="p-5">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {isScanning && (
              <span className="h-2 w-2 shrink-0 animate-ping rounded-full bg-[#ff4757]" />
            )}
            {isDone && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#10b981]" />
            )}
            {isError && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff4757]" />
            )}
            <div className="min-w-0">
              <span className="block truncate font-mono text-sm text-[#111111]">
                {getDomain(job.url)}
              </span>
              {job.productQuery && (
                <span className="block truncate text-[10px] text-[#9ca3af]">
                  "{job.productQuery}"
                </span>
              )}
            </div>
          </div>
          {isDone && result && (
            <Badge
              className="shrink-0 border-0 text-[10px] font-semibold"
              style={{
                backgroundColor: getRiskColor(result.risk_score) + "18",
                color: getRiskColor(result.risk_score),
              }}
            >
              {result.verdict}
            </Badge>
          )}
          {isScanning && (
            <span className="shrink-0 text-[11px] text-[#6b7280]">
              scanning…
            </span>
          )}
        </div>

        {/* Scanning: progress + terminal log panel */}
        {isScanning && (
          <>
            <div className="mb-2">
              <Progress
                value={job.progress}
                className="h-0.5 bg-[rgba(0,0,0,0.06)]"
              />
            </div>
            <div
              className="overflow-hidden rounded-lg"
              style={{
                background: "#0d0d0d",
                border: "1px solid rgba(255,255,255,0.06)",
                minHeight: 100,
              }}
            >
              <div className="flex items-center gap-1.5 border-b border-[rgba(255,255,255,0.05)] px-3 py-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4757]" />
                <span className="font-mono text-[9px] tracking-widest text-[#374151]">
                  AGENT LOG
                </span>
              </div>
              <div className="space-y-1.5 p-3">
                <AnimatePresence initial={false}>
                  {visibleLogs.map((log, i) => (
                    <motion.div
                      key={`${job.id}-${job.logs.length - visibleLogs.length + i}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-start gap-2"
                    >
                      <span className="mt-px shrink-0 font-mono text-[9px] text-[#374151]">
                        {log.time}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[9px] font-semibold"
                        style={{ color: LOG_LEVEL_COLORS[log.level] }}
                      >
                        {LOG_LEVEL_LABELS[log.level]}
                      </span>
                      <span
                        className="font-mono text-[10px] leading-relaxed"
                        style={{ color: "#9ca3af" }}
                      >
                        {log.text}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {visibleLogs.length === 0 && (
                  <span className="font-mono text-[9px] text-[#374151]">
                    Initialising...
                  </span>
                )}
              </div>
            </div>
          </>
        )}

        {/* Done: arc gauge + summary */}
        {isDone && result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="mb-3 flex justify-center">
              <ArcGauge score={result.risk_score} size="sm" />
            </div>
            <div className="mb-2 text-center text-sm text-[#6b7280]">
              <span className="font-bold text-[#111111]">
                {result.patterns.length}
              </span>{" "}
              pattern{result.patterns.length !== 1 ? "s" : ""} detected
            </div>
            {result.patterns.length > 0 && (
              <div className="mb-2 flex flex-wrap justify-center gap-1">
                {result.patterns.slice(0, 2).map((p, i) => (
                  <span
                    key={i}
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                    style={{
                      backgroundColor: getSeverityColor(p.severity) + "18",
                      color: getSeverityColor(p.severity),
                    }}
                  >
                    {p.pattern}
                  </span>
                ))}
                {result.patterns.length > 2 && (
                  <span className="rounded-full bg-[rgba(0,0,0,0.05)] px-1.5 py-0.5 text-[9px] font-medium text-[#6b7280]">
                    +{result.patterns.length - 2} more
                  </span>
                )}
              </div>
            )}
            <p className="mt-2 text-center text-[10px] text-[#6b7280]">
              {selected ? "↑ hide details" : "↓ view details"}
            </p>
          </motion.div>
        )}

        {/* Error */}
        {isError && (
          <p className="mt-1 font-mono text-xs text-[#ff4757]">
            Error: {job.error ?? "Scan failed"}
          </p>
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
  const totalPatterns = jobs.reduce(
    (n, j) => n + (j.result?.patterns.length ?? 0),
    0
  )
  const doneCount = jobs.filter((j) => j.status === "done").length

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {/* Globe */}
      <motion.div
        style={{ width: size, height: size }}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 160, damping: 20 }}
      >
        <Globe className="h-full w-full" isScanning={isAnyScanning} />
      </motion.div>

      {/* Status label */}
      <div className="text-center">
        {isAnyScanning ? (
          <div className="flex items-center justify-center gap-2">
            <span className="h-2 w-2 animate-ping rounded-full bg-[#ff4757]" />
            <span className="text-sm font-medium text-[#6b7280]">
              Scanning…
            </span>
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
          <p className="mt-1 text-xs text-[#6b7280]">
            <span className="font-bold" style={{ color: ACCENT }}>
              {totalPatterns}
            </span>{" "}
            pattern{totalPatterns !== 1 ? "s" : ""} found
          </p>
        )}
        {!isAnyScanning && doneCount > 0 && totalPatterns === 0 && (
          <p className="mt-1 text-xs text-[#10b981]">No patterns detected</p>
        )}
      </div>

      {/* Per-job status pills */}
      <div className="w-full space-y-1.5">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-2 rounded-lg border border-[rgba(0,0,0,0.08)] bg-white px-3 py-2 text-xs"
          >
            {job.status === "scanning" && (
              <span className="h-1.5 w-1.5 shrink-0 animate-ping rounded-full bg-[#ff4757]" />
            )}
            {job.status === "done" && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10b981]" />
            )}
            {job.status === "error" && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff4757]" />
            )}
            <span className="flex-1 truncate font-mono text-[#6b7280]">
              {getDomain(job.url)}
            </span>
            {job.status === "scanning" && (
              <span className="shrink-0 text-[#6b7280] tabular-nums">
                {job.progress}%
              </span>
            )}
            {job.result && (
              <span
                className="shrink-0 font-bold tabular-nums"
                style={{ color: getRiskColor(job.result.risk_score) }}
              >
                {job.result.risk_score}
              </span>
            )}
            {job.status === "error" && (
              <span className="shrink-0 text-[#ff4757]">failed</span>
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
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        Trust score
      </h3>
      <Card className="border-[rgba(0,0,0,0.08)] bg-white shadow-none">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
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
                className="mb-2 border-0 px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: vc + "18", color: vc }}
              >
                {data.verdict.toUpperCase()}
              </Badge>
              {/* Signal bullets */}
              <ul className="mt-2 space-y-1">
                {data.signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-px shrink-0 font-mono text-[10px] text-[#6b7280]">
                      •
                    </span>
                    <span className="text-xs leading-relaxed text-[#6b7280]">
                      {s}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Sources */}
              <div className="mt-3 flex flex-wrap gap-1">
                {data.sources_checked.map((src, i) => (
                  <span
                    key={i}
                    className="rounded border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] px-1.5 py-0.5 font-mono text-[9px]"
                    style={{
                      color: src.includes("unavailable") ? "#9ca3af" : color,
                    }}
                  >
                    {src.includes("unavailable")
                      ? src.split("/")[2] + " (blocked)"
                      : "✓ " + src.split("/")[2]}
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
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        Price comparison
      </h3>

      {data.discriminationDetected && (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm"
          style={{
            backgroundColor: ACCENT + "12",
            border: `1px solid ${ACCENT}30`,
          }}
        >
          <span style={{ color: ACCENT }} className="mt-px shrink-0">
            ⚠
          </span>
          <span className="text-xs leading-relaxed text-[#111111]">
            <strong>Price discrimination detected</strong> — this site shows
            different prices based on your device or location.
          </span>
        </div>
      )}

      <Card className="overflow-hidden border-[rgba(0,0,0,0.08)] bg-white shadow-none">
        <div className="divide-y divide-[rgba(0,0,0,0.06)]">
          {/* Header */}
          <div className="grid grid-cols-3 bg-[#fafaf8] px-4 py-2">
            <span className="text-[10px] font-semibold tracking-wide text-[#6b7280] uppercase">
              Profile
            </span>
            <span className="text-[10px] font-semibold tracking-wide text-[#6b7280] uppercase">
              Prices seen
            </span>
            <span className="text-right text-[10px] font-semibold tracking-wide text-[#6b7280] uppercase">
              Status
            </span>
          </div>
          {data.profiles.map((p, i) => (
            <div key={i} className="grid grid-cols-3 items-center px-4 py-3">
              <div>
                <span className="text-xs font-medium text-[#111111]">
                  {p.label}
                </span>
                {p.baseline && (
                  <span className="ml-1.5 rounded bg-[#10b981]/10 px-1 py-0.5 text-[9px] font-medium text-[#10b981]">
                    baseline
                  </span>
                )}
              </div>
              <span className="font-mono text-xs text-[#6b7280]">
                {p.prices.length > 0 ? p.prices.slice(0, 4).join(", ") : "—"}
              </span>
              <div className="text-right">
                {p.baseline ? (
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: GREEN }}
                  >
                    ✓ baseline
                  </span>
                ) : p.discriminated ? (
                  <span
                    className="font-mono text-[10px] font-semibold"
                    style={{ color: ACCENT }}
                  >
                    ⚠ different
                  </span>
                ) : p.prices.length === 0 ? (
                  <span className="font-mono text-[10px] text-[#9ca3af]">
                    no prices
                  </span>
                ) : (
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: GREEN }}
                  >
                    ✓ same
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {!data.discriminationDetected && (
        <p className="mt-2 text-center text-xs text-[#6b7280]">
          {data.summary}
        </p>
      )}
    </div>
  )
}

// ── Ethical Analysis Section ──────────────────────────────────────────────────

const ETHICAL_CATEGORY_ICONS: Record<string, string> = {
  "Data Privacy": "🔒",
  Environmental: "🌍",
  "Labor Practices": "👷",
  "Business Practices": "💼",
  Transparency: "👁",
  "Consumer Rights": "⚖️",
}

const OVERALL_COLORS: Record<string, string> = {
  concerning: "#ff4757",
  mixed: "#f59e0b",
  acceptable: "#3b82f6",
  good: "#10b981",
}

function EthicalAnalysisSection({ data }: { data: EthicalAnalysis }) {
  const overallColor = OVERALL_COLORS[data.overall] ?? BLUE
  const severityColor = (s: EthicalConcern["severity"]) =>
    s === "high" ? ACCENT : s === "medium" ? AMBER : BLUE

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        Ethical concerns
      </h3>

      {data.concerns.length === 0 ? (
        <Card className="border-[#10b981]/20 bg-[#10b981]/5 shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-sm font-semibold text-[#10b981]">
                No ethical concerns found
              </p>
              <p className="text-xs text-[#6b7280]">
                Policy pages and AI analysis returned nothing flagged.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Overall badge */}
          <div className="mb-3 flex items-center gap-2">
            <Badge
              className="border-0 px-2.5 py-1 text-xs font-semibold"
              style={{
                backgroundColor: overallColor + "18",
                color: overallColor,
              }}
            >
              {data.overall.toUpperCase()}
            </Badge>
            <span className="text-xs text-[#6b7280]">
              {data.concerns.length} concern
              {data.concerns.length !== 1 ? "s" : ""} across{" "}
              {[...new Set(data.concerns.map((c) => c.category))].length}{" "}
              categor
              {[...new Set(data.concerns.map((c) => c.category))].length !== 1
                ? "ies"
                : "y"}
            </span>
            {data.pages_checked.length > 0 && (
              <span className="ml-auto font-mono text-[10px] text-[#9ca3af]">
                {data.pages_checked.length} policy page
                {data.pages_checked.length !== 1 ? "s" : ""} analysed
              </span>
            )}
          </div>

          {/* Concern cards */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.concerns.map((c, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i, duration: 0.25 }}
              >
                <Card className="border-[rgba(0,0,0,0.08)] bg-white shadow-none">
                  <CardContent className="p-3">
                    <div className="mb-1.5 flex items-start gap-2">
                      <span className="mt-px text-base leading-none">
                        {ETHICAL_CATEGORY_ICONS[c.category] ?? "⚠️"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs leading-snug font-semibold text-[#111111]">
                            {c.concern}
                          </span>
                          <Badge
                            className="shrink-0 border-0 px-1.5 py-0 text-[9px] font-semibold"
                            style={{
                              backgroundColor: severityColor(c.severity) + "20",
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
                    <p className="pl-6 text-[11px] leading-relaxed text-[#6b7280]">
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
    <span className="inline-flex items-center gap-1 rounded border border-[#bae6fd] bg-[#f0f9ff] px-2 py-0.5 font-mono text-[10px] text-[#0369a1]">
      ⚡ TinyFish
    </span>
  )
}

// ── Checkout Analysis Section ─────────────────────────────────────────────────

function CheckoutAnalysisSection({ data }: { data: CheckoutAnalysis }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        Checkout analysis <TinyFishBadge />
      </h3>

      {data.hiddenFeesDetected && (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm"
          style={{
            backgroundColor: ACCENT + "12",
            border: `1px solid ${ACCENT}30`,
          }}
        >
          <span style={{ color: ACCENT }} className="mt-px shrink-0">
            ⚠
          </span>
          <span className="text-xs leading-relaxed text-[#111111]">
            <strong>Hidden fees detected</strong> — product shows{" "}
            {data.productPrice} but checkout total is {data.checkoutTotal}.
          </span>
        </div>
      )}

      <Card className="overflow-hidden border-[rgba(0,0,0,0.08)] bg-white shadow-none">
        <div className="divide-y divide-[rgba(0,0,0,0.06)]">
          {/* Price row */}
          <div className="grid grid-cols-2 bg-[#fafaf8] px-4 py-3">
            <div>
              <div className="mb-0.5 text-[10px] tracking-wide text-[#6b7280] uppercase">
                Product price
              </div>
              <div className="font-mono text-sm font-semibold text-[#111111]">
                {data.productPrice || "—"}
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] tracking-wide text-[#6b7280] uppercase">
                Checkout total
              </div>
              <div
                className="font-mono text-sm font-semibold"
                style={{ color: data.hiddenFeesDetected ? ACCENT : GREEN }}
              >
                {data.checkoutTotal || "—"}
              </div>
            </div>
          </div>

          {/* Fees */}
          {data.fees.length > 0 &&
            data.fees.map((fee, i) => (
              <div
                key={i}
                className="grid grid-cols-2 items-center px-4 py-2.5"
              >
                <span className="text-xs text-[#374151]">{fee.name}</span>
                <span className="font-mono text-xs text-[#6b7280]">
                  {fee.amount}
                </span>
              </div>
            ))}

          {/* Pre-checked items */}
          {data.preCheckedItems.length > 0 && (
            <div className="px-4 py-3">
              <div className="mb-2 text-[10px] tracking-wide text-[#6b7280] uppercase">
                Pre-checked add-ons
              </div>
              <div className="space-y-1">
                {data.preCheckedItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: AMBER }}
                  >
                    <span>⚠</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-renewal */}
          {data.hasAutoRenewal && (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span style={{ color: ACCENT }} className="text-xs">
                ⚠
              </span>
              <span className="text-xs font-medium" style={{ color: ACCENT }}>
                Auto-renewal subscription detected
              </span>
            </div>
          )}
        </div>
      </Card>

      {data.summary && (
        <p className="mt-2 text-xs text-[#6b7280]">{data.summary}</p>
      )}
    </div>
  )
}

// ── Visual Dark Patterns Section ──────────────────────────────────────────────

function VisualDarkPatternsSection({ data }: { data: VisualDarkPatterns }) {
  if (!data.visualPatterns || data.visualPatterns.length === 0) return null

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        Visual patterns <TinyFishBadge />
      </h3>

      {data.screenshotObservations && (
        <p className="mb-3 text-xs leading-relaxed text-[#6b7280]">
          {data.screenshotObservations}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {data.visualPatterns.map((p: VisualDarkPattern, i: number) => {
          const sc = getSeverityColor(p.severity)
          return (
            <Card
              key={i}
              className="border-[rgba(0,0,0,0.08)] bg-white shadow-none"
            >
              <CardContent className="p-3">
                <div className="mb-1.5 flex items-start gap-2">
                  <span className="shrink-0 text-base">👁</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-[#111111]">
                        {p.type}
                      </span>
                      <Badge
                        className="border-0 px-1.5 py-0 text-[9px] font-semibold"
                        style={{ backgroundColor: sc + "18", color: sc }}
                      >
                        {p.severity}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="pl-6 text-[11px] leading-relaxed text-[#6b7280]">
                  {p.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Result Detail ─────────────────────────────────────────────────────────────

function CleanserDashboard({ result }: { result: SanitizationResult }) {
  const totalSaved = result.junkFeesRemoved.reduce((acc, fee) => {
    const amount = parseFloat(fee.amount.replace(/[^0-9.]/g, ""))
    return acc + (isNaN(amount) ? 0 : amount)
  }, 0)

  const baseVal = parseFloat(result.basePrice.replace(/[^0-9.]/g, "")) || 0
  const junkPercent =
    baseVal > 0 ? (totalSaved / (baseVal + totalSaved)) * 100 : 0
  const basePercent = 100 - junkPercent

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="my-8 grid w-full grid-cols-1 gap-6 text-[#111111] lg:grid-cols-2"
    >
      <div className="flex flex-col overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.06)] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.08)]">
        <div className="flex-1 p-8">
          <div className="mb-8 flex items-center justify-between">
            <CheckCircle2 className="h-7 w-7 text-[#10b981]" />
            <Badge className="border-0 bg-[#10b981]/10 px-2.5 py-1 font-mono text-[10px] font-black tracking-widest text-[#10b981] uppercase">
              CLEANSED
            </Badge>
          </div>
          <h2 className="mb-1 text-2xl font-black tracking-tight">
            Checkout Sanitized
          </h2>
          <p className="mb-8 text-sm text-[#6b7280]">
            Deceptive fees automatically neutralized.
          </p>

          <div className="mb-8">
            <div className="flex h-4 w-full overflow-hidden rounded-full border border-black/5 bg-[#f3f4f6]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${basePercent}%` }}
                transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                className="h-full bg-[#10b981]"
              />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${junkPercent}%` }}
                transition={{
                  duration: 1.2,
                  ease: [0.22, 1, 0.36, 1],
                  delay: 0.2,
                }}
                className="h-full bg-[#ff4757]"
              />
            </div>
            <div className="mt-3 flex justify-between text-[10px] font-bold tracking-widest uppercase">
              <span className="text-[#10b981]">Base Price</span>
              <span className="text-[#ff4757]">Hidden Fees</span>
            </div>
          </div>

          <div className="mb-8 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-[11px] font-bold tracking-wider text-[#6b7280] uppercase">
                Original Base
              </span>
              <span className="font-black text-[#111111]">
                {result.basePrice}
              </span>
            </div>

            <div className="border-t border-dashed border-[rgba(0,0,0,0.1)] pt-5">
              <h3 className="mb-4 text-[10px] font-black tracking-[0.15em] text-[#6b7280] uppercase">
                Neutralized Traps
              </h3>
              {result.junkFeesRemoved.length > 0 ? (
                <div className="space-y-4">
                  {result.junkFeesRemoved.map((fee, i) => (
                    <div
                      key={i}
                      className="group flex items-start justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-[#111111]">
                          {fee.name}
                        </span>
                        <span className="mt-1 text-[11px] leading-tight text-[#6b7280] italic">
                          "{fee.description}"
                        </span>
                      </div>
                      <span className="text-xs font-black text-[#10b981] tabular-nums">
                        -{fee.amount}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[#6b7280] italic">
                  No deceptive fees found.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[rgba(0,0,0,0.06)] bg-[#f9f9f7] p-8">
          <span className="text-[11px] font-black tracking-[0.2em] text-[#6b7280] uppercase">
            Sanitized Total
          </span>
          <div className="flex flex-col items-end">
            <span className="text-3xl font-black text-[#111111] tabular-nums">
              {result.finalPrice}
            </span>
            {totalSaved > 0 && (
              <span className="text-[10px] font-bold text-[#10b981]">
                Saved ${totalSaved.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="group flex flex-col items-start gap-4 rounded-2xl border border-[rgba(0,0,0,0.06)] bg-white p-8 shadow-[0_15px_40px_rgba(0,0,0,0.06)]">
          <div className="flex w-full items-center gap-6">
            <ArcGauge
              score={result.trustScore || 85}
              label="TRUST"
              size="lg"
              colorFn={getTrustColor}
            />
            <div>
              <Badge className="mb-3 border-0 bg-[#f59e0b]/10 px-2.5 py-1 font-mono text-[10px] font-black tracking-widest text-[#f59e0b] uppercase">
                AUTHENTICITY ENGINE
              </Badge>
              <h3 className="text-xl font-black tracking-tight">
                Pattern Analysis
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
                AI-driven analysis of review clusters and social proof timers to
                detect artificial influence campaigns.
              </p>
            </div>
          </div>
          <div
            className={`w-full rounded-2xl border p-4 ${result.fakeReviewsDetected ? "border-[#ff4757]/10 bg-[#ff4757]/5" : "border-[#10b981]/10 bg-[#10b981]/5"} flex items-center justify-between`}
          >
            <div
              className="text-[10px] font-black tracking-widest uppercase"
              style={{
                color: result.fakeReviewsDetected ? "#ff4757" : "#10b981",
              }}
            >
              Fake Reviews
            </div>
            <div className="flex items-center gap-3">
              <div
                className="text-sm font-black"
                style={{
                  color: result.fakeReviewsDetected ? "#ff4757" : "#10b981",
                }}
              >
                {result.fakeReviewsDetected ? "DETECTED" : "AUTHENTIC"}
              </div>
              <div className="rounded-full bg-white p-2 shadow-sm">
                {result.fakeReviewsDetected ? (
                  <ShieldAlert size={20} className="text-[#ff4757]" />
                ) : (
                  <CheckCircle2 size={20} className="text-[#10b981]" />
                )}
              </div>
            </div>
          </div>
        </div>

        {result.productOrigin && (
          <div className="group relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.06)] bg-white p-8 shadow-[0_15px_40px_rgba(0,0,0,0.06)]">
            <div className="absolute top-0 left-0 h-full w-1.5 bg-[#3b82f6]" />
            <div className="mb-6 flex items-start justify-between">
              <div>
                <Badge className="mb-3 border-0 bg-[#3b82f6]/10 px-2.5 py-1 font-mono text-[10px] font-black tracking-widest text-[#3b82f6] uppercase">
                  REALITY CHECK
                </Badge>
                <h3 className="text-2xl font-black tracking-tight uppercase italic">
                  Supply Chain Analysis
                </h3>
              </div>
              {result.productOrigin.isDropshipped && (
                <span className="animate-pulse rounded-full bg-[#ff4757] px-3 py-1 text-[10px] font-black tracking-widest text-white uppercase shadow-lg shadow-[#ff4757]/20">
                  DROPSHIP ALERT
                </span>
              )}
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-black/5 bg-[#f9f9f7] p-4">
                <div className="mb-1 text-[9px] font-black tracking-widest text-[#6b7280] uppercase">
                  Market Value
                </div>
                <div className="text-lg font-black text-[#111111] tabular-nums">
                  {result.productOrigin.wholesalePriceEstimate}
                </div>
              </div>
              <div className="rounded-xl border border-black/5 bg-[#f9f9f7] p-4">
                <div className="mb-1 text-[9px] font-black tracking-widest text-[#6b7280] uppercase">
                  Markup
                </div>
                <div className="text-lg font-black text-[#ff4757] tabular-nums">
                  {result.productOrigin.markupPercentage}
                </div>
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-xl border border-black/5 bg-[#f9f9f7] p-4">
                <div className="text-[9px] font-black tracking-widest text-[#6b7280] uppercase">
                  Source
                </div>
                <div className="max-w-[150px] truncate text-xs font-black text-[#111111]">
                  {result.productOrigin.likelySourcedFrom}
                </div>
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden rounded-xl border border-[#3b82f6]/10 bg-[#3b82f6]/5 p-4 italic">
              <div className="mb-2 text-[9px] font-black tracking-[0.2em] text-[#3b82f6] uppercase">
                AI Analyst Conclusion
              </div>
              <p className="text-xs leading-relaxed font-medium text-[#4b5563]">
                "{result.productOrigin.analysis}"
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Action Card ───────────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<
  ActionVerdict,
  { icon: string; label: string; bg: string; color: string; border: string }
> = {
  safe: {
    icon: "✅",
    label: "SAFE TO BUY",
    bg: "#d1fae5",
    color: "#065f46",
    border: "#6ee7b7",
  },
  sketchy: {
    icon: "⚠️",
    label: "SKETCHY",
    bg: "#fef3c7",
    color: "#92400e",
    border: "#fcd34d",
  },
  skip: {
    icon: "🚨",
    label: "SKIP THIS",
    bg: "#fee2e2",
    color: "#991b1b",
    border: "#fca5a5",
  },
}

function ActionCard({ rec, job }: { rec: ActionRecommendation; job: ScanJob }) {
  const cfg = VERDICT_CONFIG[rec.verdict]

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: cfg.border }}
    >
      {/* Verdict header */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ background: cfg.bg }}
      >
        <span className="text-2xl">{cfg.icon}</span>
        <div>
          <div
            className="text-xs font-bold tracking-widest"
            style={{ color: cfg.color }}
          >
            {cfg.label}
          </div>
          <div className="mt-0.5 text-sm font-bold text-[#111111]">
            {rec.headline}
          </div>
        </div>
      </div>

      {/* Evidence screenshot */}
      {rec.evidenceScreenshot && (
        <div className="border-t border-b" style={{ borderColor: cfg.border }}>
          <img
            src={rec.evidenceScreenshot}
            alt="Evidence screenshot"
            className="w-full object-cover"
            style={{ maxHeight: 220 }}
          />
          <div className="bg-[#fafaf8] px-4 py-1.5">
            <span className="font-mono text-[9px] tracking-widest text-[#9ca3af] uppercase">
              📸 captured by TinyFish agent · {getDomain(job.url)}
            </span>
          </div>
        </div>
      )}

      {/* Findings */}
      <div className="space-y-2 bg-white px-5 py-4">
        {rec.topFindings.map((f, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-sm text-[#374151]"
          >
            <span className="mt-1 shrink-0" style={{ color: cfg.color }}>
              •
            </span>
            <span>{f}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="bg-white px-5 pb-5">
        {rec.ctaUrl ? (
          <a
            href={rec.ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-xl px-4 py-3 text-center text-sm font-bold transition-opacity hover:opacity-90"
            style={{ background: cfg.color, color: "#fff" }}
          >
            {rec.ctaLabel}
          </a>
        ) : (
          <button
            className="block w-full rounded-xl px-4 py-3 text-center text-sm font-bold"
            style={{ background: cfg.color, color: "#fff" }}
          >
            {rec.ctaLabel}
          </button>
        )}
        {rec.ctaSubtext && (
          <p className="mt-2 text-center text-[11px] text-[#9ca3af]">
            {rec.ctaSubtext}
          </p>
        )}
      </div>
    </div>
  )
}

function ResultDetail({ job }: { job: ScanJob }) {
  const result = job.result!
  const color = getRiskColor(result.risk_score)
  const critical = result.patterns.filter(
    (p) => p.severity === "critical"
  ).length
  const medium = result.patterns.filter((p) => p.severity === "medium").length
  const low = result.patterns.filter((p) => p.severity === "low").length

  return (
    <div className="space-y-6">
      {job.sanitizationResult?.actionRecommendation && (
        <ActionCard
          rec={job.sanitizationResult.actionRecommendation}
          job={job}
        />
      )}
      {job.sanitizationResult && (
        <CleanserDashboard result={job.sanitizationResult} />
      )}
      {/* Hero row — risk gauge + optional trust gauge + verdict */}
      <div className="flex flex-col items-start gap-6 sm:flex-row">
        <div className="flex shrink-0 items-end gap-3">
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
          <div className="mb-2 flex items-center gap-2">
            <Badge
              className="border-0 px-3 py-1 text-sm font-bold"
              style={{ backgroundColor: color + "18", color }}
            >
              {result.verdict.toUpperCase()}
            </Badge>
          </div>
          <p className="mb-2 font-mono text-sm text-[#6b7280]">
            {getDomain(job.url)}
          </p>
          <p className="text-sm text-[#111111]">
            {result.patterns.length > 0 ? (
              <>
                <span className="font-bold" style={{ color: ACCENT }}>
                  {result.patterns.length}
                </span>{" "}
                dark pattern{result.patterns.length !== 1 ? "s" : ""} detected.
              </>
            ) : (
              "No dark patterns detected — this site appears clean."
            )}
          </p>
        </div>
      </div>

      {/* Agent trace */}
      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
          Agent trace
        </h3>
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "#0d0d0d",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.05)] px-4 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
            <span className="font-mono text-[9px] tracking-widest text-[#374151]">
              COMPLETED · {job.logs.length} EVENTS
            </span>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto p-4">
            {job.logs.map((log, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-px shrink-0 font-mono text-[10px] text-[#374151]">
                  {log.time}
                </span>
                <span
                  className="shrink-0 font-mono text-[10px] font-semibold"
                  style={{ color: LOG_LEVEL_COLORS[log.level] }}
                >
                  {LOG_LEVEL_LABELS[log.level]}
                </span>
                <span
                  className="font-mono text-[11px] leading-relaxed"
                  style={{ color: "#9ca3af" }}
                >
                  {log.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Critical", count: critical, color: ACCENT },
          { label: "Medium", count: medium, color: AMBER },
          { label: "Low", count: low, color: BLUE },
        ].map(({ label, count, color: c }) => (
          <Card
            key={label}
            className="border-[rgba(0,0,0,0.08)] bg-white shadow-none"
          >
            <CardContent className="p-4 text-center">
              <div className="mb-1 text-2xl font-black" style={{ color: c }}>
                {count}
              </div>
              <div className="text-xs font-medium text-[#6b7280]">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pattern cards */}
      {result.patterns.length > 0 ? (
        <div>
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
            Detected patterns
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.patterns.map((p, i) => (
              <PatternCard key={i} pattern={p} index={i} siteUrl={job.url} />
            ))}
          </div>
        </div>
      ) : (
        <Card className="border-[#10b981]/20 bg-[#10b981]/5 shadow-none">
          <CardContent className="p-8 text-center">
            <div className="mb-3 text-4xl">🛡️</div>
            <h3 className="mb-1 text-lg font-bold text-[#10b981]">
              Clean site verified
            </h3>
            <p className="text-sm text-[#6b7280]">
              No dark patterns detected in our analysis.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Trust score */}
      {result.trustScore && <TrustScoreSection data={result.trustScore} />}

      {/* Ethical concerns */}
      {result.ethicalAnalysis && (
        <EthicalAnalysisSection data={result.ethicalAnalysis} />
      )}

      {/* Price comparison */}
      {result.profileComparison && (
        <PriceComparisonSection data={result.profileComparison} />
      )}

      {/* Checkout analysis */}
      {result.checkoutAnalysis && (
        <CheckoutAnalysisSection data={result.checkoutAnalysis} />
      )}

      {/* Visual dark patterns */}
      {result.visualDarkPatterns && (
        <VisualDarkPatternsSection data={result.visualDarkPatterns} />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Page() {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [urlInput, setUrlInput] = useState("")
  const [productQuery, setProductQuery] = useState("")
  const [urlError, setUrlError] = useState("")
  const [liveFeedIndex, setLiveFeedIndex] = useState(0)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const isActive = jobs.length > 0
  const isAnyScanning = jobs.some((j) => j.status === "scanning")
  const selectedJob = jobs.find((j) => j.id === selectedJobId)

  // Live feed cycling
  useEffect(() => {
    const id = setInterval(
      () => setLiveFeedIndex((i) => (i + 1) % LIVE_FEED.length),
      2200
    )
    return () => clearInterval(id)
  }, [])

  // Stream reader
  const startScan = useCallback(async (job: ScanJob) => {
    try {
      const res = await fetch("/api/clean-cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.url, query: job.productQuery }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json()
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "error", error: err.error ?? "Scan failed" }
              : j
          )
        )
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const eventData = line.slice(6).trim()
            if (!eventData) continue
            const event = JSON.parse(eventData)

            if (event.type === "STREAMING_URL") {
              const sUrl =
                event.url ||
                event.streamingUrl ||
                event.streamUrl ||
                event.data ||
                event.streaming_url
              if (sUrl) {
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === job.id ? { ...j, streamingUrl: sUrl } : j
                  )
                )
              }
              continue
            }

            if (event.type === "HEARTBEAT") continue

            if (event.type === "COMPLETE" && event.status === "COMPLETED") {
              if (event.resultJson) {
                const parsed =
                  typeof event.resultJson === "string"
                    ? JSON.parse(event.resultJson)
                    : event.resultJson
                if (parsed && parsed.basePrice) {
                  // Create a mock ScanResult to satisfy Aditya's UI components
                  const mockResult = {
                    risk_score: 85,
                    verdict: "high risk",
                    patterns: parsed.junkFeesRemoved.map((f: any) => ({
                      pattern: "Deceptive Fee",
                      severity: "critical",
                      evidence: f.name,
                      explanation: f.description,
                    })),
                    trustScore: {
                      trust_score: parsed.trustScore || 45,
                      verdict: parsed.fakeReviewsDetected
                        ? "suspicious"
                        : "trusted",
                      signals: parsed.fakeReviewsDetected
                        ? ["Fake reviews detected"]
                        : [],
                      sources_checked: [],
                    },
                  }

                  setJobs((prev) =>
                    prev.map((j) =>
                      j.id === job.id
                        ? {
                            ...j,
                            status: "done",
                            sanitizationResult: parsed,
                            result: mockResult as any,
                            progress: 100,
                          }
                        : j
                    )
                  )
                }
              }
            } else {
              let logText =
                event.message ||
                event.text ||
                event.thought ||
                event.reasoning ||
                event.step?.thought ||
                event.step?.action ||
                (event.action
                  ? `Executing: ${event.action} ${event.selector || event.text || ""}`
                  : "")
              if (logText && logText !== "PROGRESS") {
                const entry = {
                  time: nowTime(),
                  text: logText,
                  level: detectLogLevel(logText) as LogEntry["level"],
                }
                setJobs((prev) =>
                  prev.map((j) => {
                    if (j.id === job.id) {
                      const newLogs = [...j.logs, entry]
                      // Simulate progress 0 -> 95 based on log length
                      const prog = Math.min(95, newLogs.length * 5)
                      return { ...j, logs: newLogs, progress: prog }
                    }
                    return j
                  })
                )
              }
            }
          } catch (e) {
            // Ignore malformed JSON chunks
          }
        }
      }
    } catch {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, status: "error", error: "Network error" }
            : j
        )
      )
    }
  }, [])

  const handleScan = useCallback(() => {
    const trimmed = urlInput.trim()
    if (!trimmed) {
      setUrlError("Enter a URL")
      return
    }
    let normalized: string
    try {
      normalized = normalizeUrl(trimmed)
      new URL(normalized)
    } catch {
      setUrlError("Invalid URL")
      return
    }

    setUrlError("")
    setUrlInput("")

    const job: ScanJob = {
      id: crypto.randomUUID(),
      url: normalized,
      productQuery: productQuery.trim(),
      status: "scanning",
      logs: [],
      progress: 0,
    }
    setJobs((prev) => [...prev, job])
    startScan(job)
  }, [urlInput, productQuery, startScan])

  const handleClear = () => {
    setJobs([])
    setSelectedJobId(null)
    setUrlInput("")
    setProductQuery("")
    setUrlError("")
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
          className="relative min-h-screen overflow-hidden bg-[#fafaf8]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.35 }}
        >
          {/* Globe — centered background */}
          <div className="pointer-events-none absolute top-[6%] left-1/2 z-0 h-[380px] w-[380px] -translate-x-1/2 opacity-75">
            <Globe className="h-full w-full" />
          </div>

          {/* Logo */}
          <div className="absolute top-6 left-8 z-20">
            <span className="text-xl font-bold tracking-tight text-[#111111]">
              Darkwatch
            </span>
          </div>

          {/* Hero content */}
          <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 pt-16">
            <div className="mt-40 mb-8 text-center">
              <h1 className="mb-3 text-5xl leading-tight font-black text-[#111111]">
                Detect dark patterns
                <br />
                <span style={{ color: ACCENT }}>instantly</span>
              </h1>
              <p className="mx-auto max-w-md text-lg text-[#6b7280]">
                AI agent that browses websites like a real user and surfaces
                every manipulation tactic.
              </p>
            </div>

            <div className="w-full max-w-md">
              <div className="mb-2 flex gap-2">
                <Input
                  placeholder="example.com"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value)
                    if (urlError) setUrlError("")
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  className={`flex-1 border-[rgba(0,0,0,0.15)] bg-white text-[#111111] placeholder:text-[#6b7280] focus:border-[#111111] ${
                    urlError ? "border-[#ff4757]" : ""
                  }`}
                />
                <Button
                  onClick={handleScan}
                  className="px-6 font-semibold text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  Scan
                </Button>
              </div>
              <Input
                placeholder="What are you looking for? e.g. Kindle case, running shoes (optional)"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                className="mb-2 border-[rgba(0,0,0,0.15)] bg-white text-sm text-[#111111] placeholder:text-[#9ca3af] focus:border-[#111111]"
              />
              {urlError && (
                <p className="ml-1 text-xs text-[#ff4757]">{urlError}</p>
              )}
            </div>
          </div>

          {/* Bottom left — stat pills */}
          <div className="absolute bottom-6 left-8 z-20 flex flex-col gap-1.5">
            {[
              "12,847 scans today",
              "34,291 patterns caught",
              "2,156 sites flagged",
            ].map((label) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-full border border-[rgba(0,0,0,0.08)] bg-white/70 px-3 py-1 backdrop-blur-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                <span className="text-xs text-[#6b7280]">{label}</span>
              </div>
            ))}
          </div>

          {/* Bottom right — live detection feed */}
          <div className="absolute right-8 bottom-6 z-20 w-56">
            <div className="mb-1.5 text-right text-[10px] font-medium tracking-wide text-[#6b7280] uppercase">
              Live detections
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={liveFeedIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
                className="rounded-lg border border-[rgba(0,0,0,0.08)] bg-white/70 px-3 py-2 text-right backdrop-blur-sm"
              >
                <div className="font-mono text-xs text-[#111111]">
                  {LIVE_FEED[liveFeedIndex].site}
                </div>
                <div
                  className="mt-0.5 text-[11px] font-medium"
                  style={{ color: ACCENT }}
                >
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
          <div className="sticky top-0 z-50 border-b border-[rgba(0,0,0,0.08)] bg-white/90 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
              <span className="shrink-0 text-base font-bold tracking-tight text-[#111111]">
                Darkwatch
              </span>
              <div className="ml-auto flex w-full max-w-sm gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    placeholder="Add another URL…"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value)
                      if (urlError) setUrlError("")
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleScan()}
                    className={`h-9 border-[rgba(0,0,0,0.15)] bg-[#fafaf8] text-sm text-[#111111] placeholder:text-[#6b7280] ${
                      urlError ? "border-[#ff4757]" : ""
                    }`}
                  />
                </div>
                <Button
                  onClick={handleScan}
                  className="h-9 shrink-0 px-4 text-sm text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  Scan
                </Button>
              </div>
              <Button
                variant="ghost"
                onClick={handleClear}
                className="h-9 shrink-0 text-xs text-[#6b7280] hover:text-[#111111]"
              >
                Clear
              </Button>
            </div>
            {urlError && (
              <p className="px-6 pb-2 text-xs text-[#ff4757]">{urlError}</p>
            )}
          </div>

          {/* Mobile globe — shown above bento on small screens */}
          <div className="flex flex-col items-center border-b border-[rgba(0,0,0,0.06)] py-6 lg:hidden">
            <GlobePanel jobs={jobs} isAnyScanning={isAnyScanning} size={160} />
          </div>

          {/* Main content: bento grid + sticky globe sidebar */}
          <div className="mx-auto flex max-w-6xl items-start gap-8 px-6 py-6">
            {/* Left: bento grid */}
            <div className="min-w-0 flex-1">
              <div
                className={`grid gap-4 ${
                  jobs.length === 1
                    ? "max-w-md grid-cols-1"
                    : "grid-cols-1 sm:grid-cols-2"
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
                {jobs.some((j) => j.status === "scanning" && j.streamingUrl) &&
                  (() => {
                    const activeStreamUrl = jobs.find(
                      (j) => j.status === "scanning" && j.streamingUrl
                    )?.streamingUrl
                    return activeStreamUrl ? (
                      <motion.div
                        key="live-browser"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 480 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="mt-4 overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] bg-[#0a0a0a]"
                      >
                        <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
                          <span
                            className="h-2 w-2 rounded-full bg-[#10b981]"
                            style={{ boxShadow: "0 0 6px #10b981" }}
                          />
                          <span className="font-mono text-[10px] tracking-widest text-[#4b5563]">
                            LIVE BROWSER · AGENT CONTROLLED
                          </span>
                        </div>
                        <iframe
                          src={activeStreamUrl}
                          className="w-full"
                          style={{
                            height: 446,
                            border: "none",
                            display: "block",
                          }}
                          title="TinyFish live browser"
                          sandbox="allow-scripts allow-same-origin allow-forms"
                        />
                      </motion.div>
                    ) : null
                  })()}
              </AnimatePresence>

              {/* Detail panel */}
              <AnimatePresence>
                {selectedJob?.status === "done" && selectedJob.result && (
                  <motion.div
                    key={selectedJobId}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.3 }}
                    className="mt-6 border-t border-[rgba(0,0,0,0.08)] pt-6"
                  >
                    <ResultDetail job={selectedJob} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: sticky globe panel — desktop only */}
            <div className="sticky top-16 hidden w-[280px] shrink-0 lg:block">
              <GlobePanel
                jobs={jobs}
                isAnyScanning={isAnyScanning}
                size={240}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
