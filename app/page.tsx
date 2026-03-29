"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Globe } from "@/components/globe"
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
  ActionRecommendation,
  MarketplaceComparison,
  MarketplaceResult,
  SanitizedReceipt,
  WholesaleBenchmark,
} from "@/lib/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type LogEntry = {
  time: string
  text: string
  level: "info" | "action" | "warn" | "success"
}

type TrustCheckEntry = {
  source: string
  status: "scanning" | "done" | "failed"
  finding?: string
}

type LiveScreenshotEntry = {
  streamId: string
  label: string
  dataUrl: string
}

type ScanJob = {
  id: string
  url: string
  productQuery: string
  status: "scanning" | "done" | "error"
  logs: LogEntry[]
  progress: number
  streamingUrls: { url: string; label: string }[]
  liveScreenshots: LiveScreenshotEntry[]
  trustChecks: TrustCheckEntry[]
  result?: ScanResult
  error?: string
}

// ── Brand ─────────────────────────────────────────────────────────────────────

function ReticleMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      {/* top-left corner */}
      <path
        d="M2 7V2h5"
        stroke="#ff4757"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* top-right corner */}
      <path
        d="M13 2h5v5"
        stroke="#ff4757"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* bottom-left corner */}
      <path
        d="M2 13v5h5"
        stroke="#ff4757"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* bottom-right corner */}
      <path
        d="M18 13v5h-5"
        stroke="#ff4757"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* center dot */}
      <circle cx="10" cy="10" r="1.6" fill="#ff4757" />
    </svg>
  )
}

function DarkwatchLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const markSize = size === "lg" ? 24 : size === "md" ? 20 : 16
  const textSz =
    size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm"
  return (
    <span className={`inline-flex items-center gap-2 select-none`}>
      <ReticleMark size={markSize} />
      <span
        className={`font-display ${textSz} leading-none tracking-[-0.01em]`}
      >
        <span
          className="font-black text-[#111111]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 900 }}
        >
          DARK
        </span>
        <span
          className="font-bold text-[#888]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
        >
          WATCH
        </span>
      </span>
    </span>
  )
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
}

const MARKETPLACE_VERDICT_CFG: Record<
  string,
  { color: string; bg: string; label: string }
> = {
  "best-value": { color: GREEN, bg: "#d1fae5", label: "Best Value" },
  comparable: { color: BLUE, bg: "#dbeafe", label: "Comparable" },
  premium: { color: AMBER, bg: "#fef3c7", label: "Premium" },
  avoid: { color: ACCENT, bg: "#fee2e2", label: "Avoid" },
}

const SITE_VERDICT_CFG: Record<
  string,
  { color: string; bg: string; label: string; icon: string }
> = {
  "good-deal": {
    color: GREEN,
    bg: "#d1fae5",
    label: "Good deal compared to alternatives",
    icon: "✅",
  },
  fair: { color: AMBER, bg: "#fef3c7", label: "Fair market price", icon: "⚖️" },
  overpriced: {
    color: ACCENT,
    bg: "#fee2e2",
    label: "Overpriced — better options below",
    icon: "⚠️",
  },
}

const DATA_CONFIDENCE_CFG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  "verified-live": { label: "Verified live", color: GREEN, bg: "#d1fae5" },
  "verified-user": { label: "Verified by you", color: BLUE, bg: "#dbeafe" },
  blocked: { label: "Blocked", color: ACCENT, bg: "#fee2e2" },
  unverified: { label: "Needs retry", color: AMBER, bg: "#fef3c7" },
}

const RECOVERY_ACTION_LABELS: Record<string, string> = {
  "retry-slow": "Retry slow mode",
  "handoff-human": "Handoff to human",
  "switch-source": "Switch source",
  defer: "Defer",
}
const LOG_LEVEL_LABELS = {
  info: "INFO",
  action: "ACT ",
  warn: "WARN",
  success: "DONE",
}

function detectLogLevel(msg: string): LogEntry["level"] {
  if (
    msg.includes("⚠") ||
    msg.includes("Error") ||
    msg.includes("DETECTED") ||
    msg.includes("scam")
  )
    return "warn"
  if (
    msg.includes("complete") ||
    msg.includes("✓") ||
    msg.includes("Reddit:") ||
    msg.includes("Verdict:") ||
    msg.includes("Scan complete")
  )
    return "success"
  if (
    msg.includes("[Playwright]") ||
    msg.includes("Browser") ||
    msg.includes("browser") ||
    msg.includes("Navigating") ||
    msg.includes("Searching") ||
    msg.includes("Reading") ||
    msg.includes("Clicking") ||
    msg.includes("Adding") ||
    msg.includes("Proceeding") ||
    msg.includes("Opening") ||
    msg.includes("Comparing") ||
    msg.includes("posts —") ||
    msg.includes("comments from")
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.3 }}
    >
      <Card
        className="overflow-hidden bg-white shadow-none"
        style={{
          borderColor: "rgba(0,0,0,0.08)",
          borderLeftColor: color,
          borderLeftWidth: 3,
        }}
      >
        {/* Screenshot evidence captured by Playwright */}
        {pattern.evidenceScreenshot && (
          <div className="relative">
            <img
              src={pattern.evidenceScreenshot}
              alt={`Evidence: ${pattern.pattern}`}
              className="w-full border-b border-[rgba(0,0,0,0.06)] object-cover"
              style={{ maxHeight: 200 }}
            />
            <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-1.5">
              <span className="font-mono text-[9px] tracking-widest text-white/80 uppercase">
                📸 live browser evidence
              </span>
            </div>
          </div>
        )}
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
          <div className="rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
            <span className="mb-1 block text-[10px] font-medium tracking-wide text-[#6b7280] uppercase">
              Evidence
            </span>
            <code className="font-mono text-xs leading-relaxed text-[#111111]">
              &ldquo;{pattern.evidence}&rdquo;
            </code>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Trust Intelligence Panel ──────────────────────────────────────────────────

const SOURCE_ICONS: Record<string, string> = {
  Trustpilot: "⭐",
  Sitejabber: "🔎",
  ScamAdviser: "🛡",
  Reddit: "💬",
  "GPT-4o Analysis": "🤖",
  "Ethics · Privacy": "🔒",
  "Ethics · Labor": "👷",
  "Ethics · Environment": "🌍",
}

function TrustIntelPanel({ checks }: { checks: TrustCheckEntry[] }) {
  if (checks.length === 0) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] bg-[#0a0a0a]"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#a78bfa]" />
        <span className="font-mono text-[10px] tracking-widest text-[#4b5563]">
          TRUST INTELLIGENCE · SCANNING {checks.length} SOURCES
        </span>
      </div>

      {/* Source rows */}
      <div className="divide-y divide-[rgba(255,255,255,0.04)]">
        {checks.map((c) => (
          <motion.div
            key={c.source}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            {/* Status dot */}
            {c.status === "scanning" && (
              <span className="h-1.5 w-1.5 shrink-0 animate-ping rounded-full bg-[#f59e0b]" />
            )}
            {c.status === "done" && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10b981]" />
            )}
            {c.status === "failed" && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#374151]" />
            )}

            {/* Icon + source name */}
            <span className="shrink-0 text-sm leading-none">
              {SOURCE_ICONS[c.source] ?? "🌐"}
            </span>
            <span className="w-28 shrink-0 font-mono text-[11px] text-[#9ca3af]">
              {c.source}
            </span>

            {/* Finding / status text */}
            <span
              className="truncate font-mono text-[11px]"
              style={{
                color:
                  c.status === "scanning"
                    ? "#4b5563"
                    : c.status === "failed"
                      ? "#374151"
                      : "#6ee7b7",
              }}
            >
              {c.status === "scanning"
                ? "scanning..."
                : c.status === "failed"
                  ? (c.finding ?? "blocked")
                  : (c.finding ?? "done")}
            </span>
          </motion.div>
        ))}
      </div>
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

  const domain = getDomain(job.url)
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

  return (
    <Card
      className={`overflow-hidden bg-white shadow-none transition-all ${isDone ? "cursor-pointer" : ""} ${
        selected
          ? "border-[#111111] ring-1 ring-[rgba(0,0,0,0.12)]"
          : isError
            ? "border-[#ff4757]/30"
            : isScanning
              ? "border-[rgba(255,71,87,0.35)]"
              : "border-[rgba(0,0,0,0.08)] hover:border-[rgba(0,0,0,0.18)]"
      }`}
      style={
        isScanning
          ? {
              boxShadow:
                "0 0 0 1px rgba(255,71,87,0.12), 0 4px 20px rgba(255,71,87,0.08)",
            }
          : undefined
      }
      onClick={isDone ? onClick : undefined}
    >
      {/* Product thumbnail — full-bleed at top when available */}
      {isDone && result?.productImageUrl && (
        <div
          className="relative w-full overflow-hidden bg-[#f4f4f2]"
          style={{ height: 160 }}
        >
          <img
            src={result.productImageUrl}
            alt="Product"
            className="h-full w-full object-contain"
            onError={(e) => {
              ;(e.target as HTMLImageElement).parentElement!.style.display =
                "none"
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-white/60 to-transparent" />
        </div>
      )}

      <CardContent className="p-5">
        {/* Header — site identity */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative shrink-0">
              {isScanning && (
                <span className="absolute -top-0.5 -right-0.5 z-10 h-2 w-2 animate-ping rounded-full bg-[#ff4757]" />
              )}
              {isDone && (
                <span className="absolute -top-0.5 -right-0.5 z-10 h-2 w-2 rounded-full bg-[#10b981]" />
              )}
              {isError && (
                <span className="absolute -top-0.5 -right-0.5 z-10 h-2 w-2 rounded-full bg-[#ff4757]" />
              )}
              <img
                src={favicon}
                alt=""
                className="h-7 w-7 rounded-lg border border-[rgba(0,0,0,0.08)]"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = "none"
                }}
              />
            </div>
            <div className="min-w-0">
              <span
                className="block truncate text-sm leading-tight font-black text-[#111111]"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "0.95rem",
                  letterSpacing: "0.01em",
                }}
              >
                {domain}
              </span>
              {job.productQuery && (
                <span className="mt-0.5 block truncate text-[11px] text-[#6b7280]">
                  searching for{" "}
                  <span className="font-semibold text-[#374151]">
                    "{job.productQuery}"
                  </span>
                </span>
              )}
            </div>
          </div>
          {isDone && result && (
            <Badge
              className="shrink-0 border-0 px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase"
              style={{
                backgroundColor: getRiskColor(result.risk_score) + "15",
                color: getRiskColor(result.risk_score),
              }}
            >
              {result.verdict}
            </Badge>
          )}
          {isScanning && (
            <span
              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black text-white"
              style={{
                backgroundColor: ACCENT,
                fontFamily: "var(--font-display)",
                letterSpacing: "0.08em",
              }}
            >
              ACTIVE
            </span>
          )}
        </div>

        {/* Scanning: progress + terminal log panel */}
        {isScanning && (
          <>
            {/* Custom glowing progress bar */}
            <div className="relative mb-3 h-[3px] overflow-hidden rounded-full bg-[rgba(0,0,0,0.06)]">
              <div
                className="absolute top-0 left-0 h-full rounded-full transition-all duration-700"
                style={{
                  width: `${job.progress}%`,
                  background: `linear-gradient(90deg, ${ACCENT}99, ${ACCENT})`,
                  boxShadow: `0 0 8px ${ACCENT}`,
                }}
              />
              {/* Animated pulse dot at tip */}
              {job.progress > 2 && (
                <div
                  className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `calc(${job.progress}% - 4px)`,
                    backgroundColor: ACCENT,
                    boxShadow: `0 0 6px ${ACCENT}, 0 0 12px ${ACCENT}66`,
                  }}
                />
              )}
            </div>
            <div
              className="log-scanline overflow-hidden rounded-xl"
              style={{
                background: "#0d0d0d",
                border: "1px solid rgba(255,255,255,0.06)",
                minHeight: 100,
              }}
            >
              <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.05)] px-3 py-1.5">
                <ReticleMark size={12} />
                <span className="font-mono text-[9px] tracking-widest text-[#4b5563]">
                  DARKWATCH AGENT
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4757]" />
                  <span className="font-mono text-[9px] text-[#ff4757]">
                    LIVE
                  </span>
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

        {/* Done: verdict + headline + signals */}
        {isDone && result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {(() => {
              const rec = result.actionRecommendation
              const cfg = rec ? VERDICT_CONFIG[rec.verdict] : null
              return (
                <>
                  {/* Verdict banner */}
                  {cfg && rec ? (
                    <div
                      className="mb-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                      style={{
                        background: cfg.bg,
                        border: `1px solid ${cfg.border}`,
                      }}
                    >
                      <span className="mt-0.5 text-xl leading-none">
                        {cfg.icon}
                      </span>
                      <div className="min-w-0">
                        <div
                          className="mb-0.5 text-[9px] font-bold tracking-widest"
                          style={{ color: cfg.color }}
                        >
                          {cfg.label}
                        </div>
                        <div className="text-sm leading-snug font-semibold text-[#111111]">
                          {rec.headline}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-3 flex justify-center">
                      <ArcGauge score={result.risk_score} size="sm" />
                    </div>
                  )}

                  {/* Signal pills — always show something interesting */}
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {result.patterns.length > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: ACCENT + "15",
                          color: ACCENT,
                        }}
                      >
                        🚫 {result.patterns.length} junk fee
                        {result.patterns.length > 1 ? "s" : ""} found
                      </span>
                    )}
                    {rec?.ctaUrl && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: BLUE + "15", color: BLUE }}
                      >
                        📦 Dropshipped
                      </span>
                    )}
                    {result.trustScore &&
                      result.trustScore.trust_score < 55 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{
                            backgroundColor: AMBER + "15",
                            color: "#92400e",
                          }}
                        >
                          ⚠ Trust {result.trustScore.trust_score}/100
                        </span>
                      )}
                    {result.trustScore?.signals?.some((s) =>
                      s.toLowerCase().includes("fake")
                    ) && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: AMBER + "15",
                          color: "#92400e",
                        }}
                      >
                        ⭐ Fake reviews
                      </span>
                    )}
                    {result.patterns.length === 0 &&
                      !rec?.ctaUrl &&
                      result.trustScore &&
                      result.trustScore.trust_score >= 55 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{
                            backgroundColor: GREEN + "15",
                            color: "#065f46",
                          }}
                        >
                          ✓ No red flags
                        </span>
                      )}
                  </div>

                  <p className="text-center text-[10px] text-[#6b7280]">
                    {selected ? "↑ hide details" : "↓ tap for full analysis"}
                  </p>
                </>
              )
            })()}
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
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff4757] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff4757]" />
            </span>
            <span
              className="font-black text-[#111111]"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "0.9rem",
                letterSpacing: "0.06em",
              }}
            >
              AGENT ACTIVE
            </span>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-black text-[#10b981]"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "0.9rem",
              letterSpacing: "0.04em",
            }}
          >
            ANALYSIS COMPLETE
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
  const verdictColors: Record<string, string> = {
    trusted: GREEN,
    caution: AMBER,
    suspicious: ACCENT,
    dangerous: ACCENT,
  }
  const vc = verdictColors[data.verdict] ?? BLUE

  // Plain-English verdict labels consumers actually understand
  const verdictLabel: Record<string, string> = {
    trusted: "Shoppers generally trust this store",
    caution: "Some shoppers have had bad experiences",
    suspicious: "Many complaints — shop with caution",
    dangerous: "High scam risk — avoid this store",
  }

  const quotes = data.keyQuotes ?? []
  const sourceUrls = data.sourceUrls ?? []
  const sourceMix = (() => {
    let verified = 0
    let limited = 0
    let blocked = 0
    for (const src of data.sources_checked) {
      if (src.includes("unavailable")) blocked += 1
      else if (src.includes("no snippets")) limited += 1
      else verified += 1
    }
    const total = data.sources_checked.length
    return { verified, limited, blocked, total }
  })()

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        <span>💬</span> What shoppers are saying
      </h3>

      {/* Verdict banner */}
      <div
        className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
        style={{ backgroundColor: vc + "12", border: `1px solid ${vc}25` }}
      >
        <ArcGauge
          score={data.trust_score}
          size="sm"
          colorFn={getTrustColor}
          label="TRUST"
        />
        <div>
          <p className="text-sm font-semibold" style={{ color: vc }}>
            {verdictLabel[data.verdict] ?? data.verdict}
          </p>
          <p className="mt-0.5 text-[11px] text-[#6b7280]">
            Based on{" "}
            {
              data.sources_checked.filter((s) => !s.includes("unavailable"))
                .length
            }{" "}
            source
            {data.sources_checked.filter((s) => !s.includes("unavailable"))
              .length !== 1
              ? "s"
              : ""}{" "}
            checked
          </p>
          <p className="mt-1 text-[10px] text-[#6b7280]">
            Source mix: {sourceMix.verified} verified · {sourceMix.limited}{" "}
            limited · {sourceMix.blocked} blocked
          </p>
          {sourceMix.total > 0 && (
            <div className="mt-1.5 h-1.5 w-48 overflow-hidden rounded-full bg-[rgba(0,0,0,0.08)]">
              <div className="flex h-full w-full">
                <div
                  style={{
                    width: `${(sourceMix.verified / sourceMix.total) * 100}%`,
                    backgroundColor: GREEN,
                  }}
                />
                <div
                  style={{
                    width: `${(sourceMix.limited / sourceMix.total) * 100}%`,
                    backgroundColor: AMBER,
                  }}
                />
                <div
                  style={{
                    width: `${(sourceMix.blocked / sourceMix.total) * 100}%`,
                    backgroundColor: "#d1d5db",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Real user quotes — front and centre */}
      {quotes.length > 0 && (
        <div className="mb-4 space-y-2">
          {quotes.map((quote, i) => (
            <div
              key={i}
              className="rounded-xl px-4 py-3"
              style={{
                backgroundColor: vc + "08",
                borderLeft: `3px solid ${vc}50`,
              }}
            >
              <p className="text-sm leading-relaxed text-[#111111] italic">
                &ldquo;{quote}&rdquo;
              </p>
              {sourceUrls[i] && (
                <a
                  href={sourceUrls[i]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] hover:underline"
                  style={{ color: vc }}
                >
                  View source →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Signal bullets */}
      {data.signals.length > 0 && (
        <ul className="mb-4 space-y-1">
          {data.signals.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs text-[#374151]"
            >
              <span className="mt-0.5 shrink-0" style={{ color: vc }}>
                •
              </span>
              {s}
            </li>
          ))}
        </ul>
      )}

      {/* Sources — clickable links to actual review pages */}
      <div className="space-y-1.5">
        <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#6b7280] uppercase">
          Sources checked
        </p>
        {data.sources_checked.map((src, i) => {
          const blocked = src.includes("unavailable")
          const cleanSrc = blocked ? src.replace(" (unavailable)", "") : src
          // Try to get a readable label from the URL
          const hostname = (() => {
            try {
              return new URL(cleanSrc).hostname.replace("www.", "")
            } catch {
              return cleanSrc
            }
          })()
          const pathPart = (() => {
            try {
              const p = new URL(cleanSrc).pathname
              return p !== "/"
                ? p.split("/").filter(Boolean).slice(0, 2).join("/")
                : ""
            } catch {
              return ""
            }
          })()
          const label = hostname + (pathPart ? `/${pathPart}` : "")
          return blocked ? (
            <div key={i} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d1d5db]" />
              <span className="font-mono text-[10px] text-[#9ca3af] line-through">
                {label}
              </span>
              <span className="text-[9px] text-[#9ca3af]">blocked</span>
            </div>
          ) : (
            <a
              key={i}
              href={cleanSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: vc }}
              />
              <span
                className="font-mono text-[10px] group-hover:underline"
                style={{ color: vc }}
              >
                {label}
              </span>
              <span className="text-[9px] text-[#9ca3af]">→</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

// ── Price Comparison Section ──────────────────────────────────────────────────

function PriceComparisonSection({ data }: { data: ProfileComparison }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        <span className="h-3 w-[2px] rounded-full bg-[#ff4757]" />
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

const OVERALL_LABELS: Record<string, string> = {
  concerning: "Serious concerns — know what you're supporting",
  mixed: "Some concerns — worth knowing before you buy",
  acceptable: "Mostly clean — minor points flagged",
  good: "No ethical concerns found",
}

const SEVERITY_LABELS: Record<string, string> = {
  high: "Serious",
  medium: "Worth knowing",
  low: "Minor",
}

// ── Marketplace comparison ─────────────────────────────────────────────────────

function MarketplaceComparisonSection({
  data,
  productQuery,
  currentDomain,
}: {
  data: MarketplaceComparison
  productQuery: string
  currentDomain: string
}) {
  const [overrides, setOverrides] = useState<Record<string, MarketplaceResult>>(
    {}
  )
  const [retrying, setRetrying] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string>("")
  const [plannerNote, setPlannerNote] = useState<string>("")
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})
  const [manualInput, setManualInput] = useState<
    Record<string, { price: string; screenshot: string }>
  >({})

  const siteVerdictCfg =
    SITE_VERDICT_CFG[data.currentSiteVerdict] ?? SITE_VERDICT_CFG["fair"]

  const mergedResults = data.results.map((r) => overrides[r.marketplace] ?? r)

  // Keep all results visible; unknown prices are shown as unavailable.
  const hasRealPrice = (r: MarketplaceResult) =>
    r.priceRange &&
    r.priceRange !== "unknown" &&
    r.priceRange !== "—" &&
    r.priceRange !== ""

  const parsePriceValue = (raw: string): number | null => {
    const m = raw.match(/[$£€]\s*([\d,.]+)/)
    if (!m) return null
    const n = Number(m[1].replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
  }

  const computedWinner = (() => {
    const priced = mergedResults
      .map((r) => ({ r, n: parsePriceValue(r.priceRange) }))
      .filter((x) => x.n != null) as Array<{ r: MarketplaceResult; n: number }>
    if (priced.length === 0) return data.winner
    priced.sort((a, b) => a.n - b.n)
    return priced[0].r.marketplace
  })()

  const orderedResults = [...mergedResults].sort((a, b) =>
    a.marketplace === computedWinner
      ? -1
      : b.marketplace === computedWinner
        ? 1
        : 0
  )

  const blockedResults = mergedResults.filter((r) => !hasRealPrice(r))
  const planByMarketplace = Object.fromEntries(
    (data.recoveryPlans ?? []).map((p) => [p.marketplace, p])
  )
  const sourceMix = (() => {
    const verified = mergedResults.filter(
      (r) =>
        r.dataConfidence === "verified-live" ||
        r.dataConfidence === "verified-user"
    ).length
    const blocked = mergedResults.filter(
      (r) => r.dataConfidence === "blocked"
    ).length
    const unverified = mergedResults.filter(
      (r) => r.dataConfidence === "unverified"
    ).length
    return { verified, blocked, unverified, total: mergedResults.length }
  })()

  const handleRetry = async (marketplace: string) => {
    setRetryError("")
    setRetrying(marketplace)
    try {
      const res = await fetch("/api/marketplace-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: productQuery,
          currentDomain,
          marketplace,
        }),
      })
      const payload = await res.json()
      if (!res.ok) {
        throw new Error(payload?.error ?? "Retry failed")
      }
      const updated = payload?.result as MarketplaceResult | undefined
      if (!updated) throw new Error("Retry returned no data")
      setOverrides((prev) => ({ ...prev, [marketplace]: updated }))
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed")
    } finally {
      setRetrying(null)
    }
  }

  const submitManualVerify = (marketplace: string) => {
    const source =
      overrides[marketplace] ??
      data.results.find((r) => r.marketplace === marketplace)
    if (!source) return

    const rawPrice = manualInput[marketplace]?.price?.trim() ?? ""
    if (!rawPrice) return
    const normalizedPrice = /^[£$€]/.test(rawPrice) ? rawPrice : `$${rawPrice}`
    const screenshot = manualInput[marketplace]?.screenshot?.trim() ?? ""
    const evidenceNote = screenshot
      ? " Verified with user-provided screenshot evidence."
      : " Verified manually by user input."

    setOverrides((prev) => ({
      ...prev,
      [marketplace]: {
        ...source,
        priceRange: normalizedPrice,
        dataConfidence: "verified-user",
        dataSourceNote: `Price confirmed by user.${evidenceNote}`,
        verdictReason: "Manual verification added by user.",
      },
    }))
    setManualOpen((prev) => ({ ...prev, [marketplace]: false }))
  }

  const runRecommendedAction = async (marketplace: string) => {
    const plan = planByMarketplace[marketplace]
    if (!plan) return
    setPlannerNote("")

    if (plan.nextAction === "retry-slow") {
      await handleRetry(marketplace)
      return
    }

    if (plan.nextAction === "handoff-human") {
      setManualOpen((prev) => ({ ...prev, [marketplace]: true }))
      setPlannerNote(
        `${marketplace}: opened manual verification so you can confirm real price.`
      )
      return
    }

    if (plan.nextAction === "switch-source") {
      setPlannerNote(
        `${marketplace}: use Open listing or manual verification while source switching is added.`
      )
      return
    }

    setPlannerNote(
      `${marketplace}: planner suggests defer until source reliability improves.`
    )
  }

  return (
    <div>
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
          <span className="h-3 w-[2px] rounded-full bg-[#ff4757]" /> Where to
          buy instead
        </h3>
        {orderedResults.length > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              backgroundColor: siteVerdictCfg.bg,
              color: siteVerdictCfg.color,
            }}
          >
            {siteVerdictCfg.icon} {siteVerdictCfg.label}
          </span>
        )}
      </div>

      {/* Current site verdict note */}
      {data.currentSiteNote && orderedResults.length > 0 && (
        <p className="mb-4 text-xs leading-relaxed text-[#374151]">
          {data.currentSiteNote}
        </p>
      )}

      {sourceMix.total > 0 && (
        <div className="mb-3 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-2.5">
          <p className="text-[10px] text-[#6b7280]">
            Source mix: {sourceMix.verified} verified · {sourceMix.unverified}{" "}
            unverified · {sourceMix.blocked} blocked
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(0,0,0,0.08)]">
            <div className="flex h-full w-full">
              <div
                style={{
                  width: `${(sourceMix.verified / sourceMix.total) * 100}%`,
                  backgroundColor: GREEN,
                }}
              />
              <div
                style={{
                  width: `${(sourceMix.unverified / sourceMix.total) * 100}%`,
                  backgroundColor: AMBER,
                }}
              />
              <div
                style={{
                  width: `${(sourceMix.blocked / sourceMix.total) * 100}%`,
                  backgroundColor: "#d1d5db",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {retryError && (
        <p className="mb-3 text-xs text-[#ff4757]">
          Retry failed: {retryError}
        </p>
      )}

      {plannerNote && (
        <p className="mb-3 text-xs text-[#3b82f6]">{plannerNote}</p>
      )}

      {data.recoveryPlans && data.recoveryPlans.length > 0 && (
        <div className="mb-3 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-[#374151] uppercase">
            Smart recovery planner
          </p>
          <div className="space-y-2">
            {data.recoveryPlans.map((plan) => (
              <div
                key={`${plan.marketplace}-${plan.status}`}
                className="rounded-md border border-[rgba(0,0,0,0.06)] bg-white p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[#111111]">
                    {plan.marketplace}
                  </span>
                  <Badge
                    className="border-0 px-1.5 py-0.5 text-[9px] font-semibold"
                    style={{ backgroundColor: "#e5e7eb", color: "#4b5563" }}
                  >
                    {RECOVERY_ACTION_LABELS[plan.nextAction] ?? plan.nextAction}
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-[#6b7280]">
                  {plan.reason}
                </p>
                {plan.checklist.length > 0 && (
                  <p className="mt-1 text-[10px] text-[#9ca3af]">
                    {plan.checklist.join(" · ")}
                  </p>
                )}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => runRecommendedAction(plan.marketplace)}
                    className="rounded border border-[rgba(59,130,246,0.35)] px-2 py-1 text-[10px] font-semibold text-[#3b82f6]"
                  >
                    Do recommended action
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {orderedResults.length > 0 &&
        blockedResults.length === orderedResults.length && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
            <span className="text-base">🛡️</span>
            <p className="text-[11px] leading-relaxed text-[#6b7280]">
              All marketplace checks hit verification walls. Cards are shown for
              transparency, but live prices were unavailable.
            </p>
          </div>
        )}

      {/* No real data at all */}
      {orderedResults.length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
          <span className="mt-0.5 text-base">🛡️</span>
          <div>
            <p className="mb-0.5 text-xs font-semibold text-[#374151]">
              Marketplace comparison blocked
            </p>
            <p className="text-[11px] leading-relaxed text-[#6b7280]">
              All {blockedResults.length} marketplace
              {blockedResults.length !== 1 ? "s" : ""} (
              {blockedResults.map((r) => r.marketplace).join(", ")}) blocked
              automated price checks. Try searching manually for the best price.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Competitor cards */}
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {orderedResults.map((r: MarketplaceResult) => {
              const vc =
                MARKETPLACE_VERDICT_CFG[r.verdict] ??
                MARKETPLACE_VERDICT_CFG["comparable"]
              const dc =
                DATA_CONFIDENCE_CFG[r.dataConfidence] ??
                DATA_CONFIDENCE_CFG["unverified"]
              const isWinner = r.marketplace === computedWinner
              const unavailable = !hasRealPrice(r)
              const shopUrl = r.productPageUrl || r.searchUrl
              const isRetrying = retrying === r.marketplace
              const showManual = manualOpen[r.marketplace] ?? false
              const plan = planByMarketplace[r.marketplace]

              return (
                <div key={r.marketplace} className="group block no-underline">
                  <Card
                    className="overflow-hidden bg-white shadow-none transition-shadow hover:shadow-md"
                    style={{
                      border: isWinner
                        ? `2px solid ${AMBER}`
                        : "1px solid rgba(0,0,0,0.08)",
                    }}
                  >
                    {/* Product thumbnail */}
                    {r.thumbnailUrl && !unavailable && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.thumbnailUrl}
                        alt={r.topResultName || r.marketplace}
                        className="w-full bg-[#f3f4f6] object-cover"
                        style={{ height: 140 }}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.display =
                            "none"
                        }}
                      />
                    )}

                    <CardContent className="p-3">
                      {/* Winner badge */}
                      {isWinner && !unavailable && (
                        <div
                          className="mb-2 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide"
                          style={{
                            backgroundColor: "#fef3c7",
                            color: "#92400e",
                          }}
                        >
                          ★ BEST VALUE
                        </div>
                      )}

                      {/* Marketplace + verdict badge */}
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-[#111111]">
                          {r.marketplace}
                        </span>
                        <Badge
                          className="shrink-0 border-0 px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{ backgroundColor: vc.bg, color: vc.color }}
                        >
                          {vc.label}
                        </Badge>
                      </div>

                      <div className="mb-1.5">
                        <Badge
                          className="border-0 px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{ backgroundColor: dc.bg, color: dc.color }}
                        >
                          {dc.label}
                        </Badge>
                      </div>

                      {/* Product name */}
                      {r.topResultName && (
                        <p className="mb-1.5 line-clamp-2 text-[11px] leading-snug text-[#6b7280]">
                          {r.topResultName.slice(0, 55)}
                        </p>
                      )}

                      {/* Price — big */}
                      <div className="mb-1 font-mono text-lg leading-tight font-bold text-[#111111]">
                        {unavailable ? "—" : r.priceRange}
                      </div>

                      {/* Rating + shipping */}
                      <div className="flex flex-wrap gap-2 text-[10px] text-[#9ca3af]">
                        {r.rating && <span>{r.rating}</span>}
                        {r.shippingNote && <span>{r.shippingNote}</span>}
                      </div>

                      {/* Verdict reason */}
                      {r.verdictReason && (
                        <p className="mt-1.5 border-t border-[rgba(0,0,0,0.05)] pt-1.5 text-[10px] leading-snug text-[#6b7280]">
                          {r.verdictReason}
                        </p>
                      )}
                      {r.dataSourceNote && (
                        <p className="mt-1 text-[10px] leading-snug text-[#9ca3af]">
                          {r.dataSourceNote}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap gap-2 border-t border-[rgba(0,0,0,0.05)] pt-2">
                        <a
                          href={shopUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-[rgba(0,0,0,0.12)] px-2 py-1 text-[10px] font-semibold text-[#374151]"
                        >
                          Open listing
                        </a>

                        {(r.dataConfidence === "blocked" ||
                          r.dataConfidence === "unverified") && (
                          <button
                            type="button"
                            onClick={() => handleRetry(r.marketplace)}
                            disabled={isRetrying}
                            className="rounded border border-[rgba(255,71,87,0.35)] px-2 py-1 text-[10px] font-semibold text-[#ff4757] disabled:opacity-60"
                          >
                            {isRetrying ? "Retrying..." : "Retry slow mode"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setManualOpen((prev) => ({
                              ...prev,
                              [r.marketplace]: !showManual,
                            }))
                          }
                          className="rounded border border-[rgba(59,130,246,0.35)] px-2 py-1 text-[10px] font-semibold text-[#3b82f6]"
                        >
                          Verify manually
                        </button>

                        {plan && (
                          <button
                            type="button"
                            onClick={() => runRecommendedAction(r.marketplace)}
                            className="rounded border border-[rgba(16,185,129,0.35)] px-2 py-1 text-[10px] font-semibold text-[#10b981]"
                          >
                            Recommended:{" "}
                            {RECOVERY_ACTION_LABELS[plan.nextAction]}
                          </button>
                        )}
                      </div>

                      {showManual && (
                        <div className="mt-2 space-y-2 rounded border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-2">
                          <Input
                            value={manualInput[r.marketplace]?.price ?? ""}
                            onChange={(e) =>
                              setManualInput((prev) => ({
                                ...prev,
                                [r.marketplace]: {
                                  price: e.target.value,
                                  screenshot:
                                    prev[r.marketplace]?.screenshot ?? "",
                                },
                              }))
                            }
                            placeholder="Observed price (e.g. 19.99 or $19.99)"
                            className="h-8 text-xs"
                          />
                          <Input
                            value={manualInput[r.marketplace]?.screenshot ?? ""}
                            onChange={(e) =>
                              setManualInput((prev) => ({
                                ...prev,
                                [r.marketplace]: {
                                  price: prev[r.marketplace]?.price ?? "",
                                  screenshot: e.target.value,
                                },
                              }))
                            }
                            placeholder="Screenshot URL (optional evidence)"
                            className="h-8 text-xs"
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              className="h-7 px-2 text-[10px]"
                              onClick={() => submitManualVerify(r.marketplace)}
                            >
                              Save verification
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )
            })}
          </div>

          {/* Note about blocked marketplaces */}
          {blockedResults.length > 0 && (
            <p className="mb-2 text-[11px] text-[#9ca3af]">
              {blockedResults.map((r) => r.marketplace).join(", ")} blocked
              automated checks — prices unavailable.
            </p>
          )}

          {/* Bottom summary */}
          {data.summary && (
            <p className="text-xs leading-relaxed text-[#6b7280] italic">
              {data.summary}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Ethical analysis ───────────────────────────────────────────────────────────

function EthicalAnalysisSection({ data }: { data: EthicalAnalysis }) {
  const overallColor = OVERALL_COLORS[data.overall] ?? BLUE
  const severityColor = (s: EthicalConcern["severity"]) =>
    s === "high" ? ACCENT : s === "medium" ? AMBER : BLUE

  // Sort: high severity first
  const sorted = [...data.concerns].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2)
  })

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        <span>⚖️</span> Before you buy
      </h3>

      {data.concerns.length === 0 ? (
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            backgroundColor: GREEN + "10",
            border: `1px solid ${GREEN}25`,
          }}
        >
          <span className="text-xl">✅</span>
          <p className="text-sm font-semibold text-[#10b981]">
            No ethical concerns found
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Overall plain-language banner */}
          <div
            className="mb-3 flex items-center gap-3 rounded-xl px-4 py-3"
            style={{
              backgroundColor: overallColor + "10",
              border: `1px solid ${overallColor}25`,
            }}
          >
            <span className="text-xl">
              {data.overall === "concerning"
                ? "🚨"
                : data.overall === "mixed"
                  ? "⚠️"
                  : data.overall === "good"
                    ? "✅"
                    : "ℹ️"}
            </span>
            <p
              className="text-sm font-semibold"
              style={{ color: overallColor }}
            >
              {OVERALL_LABELS[data.overall] ?? data.overall}
            </p>
          </div>

          {/* Concern cards */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {sorted.map((c, i) => (
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
                            {SEVERITY_LABELS[c.severity] ?? c.severity}
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

// ── Playwright Badge ──────────────────────────────────────────────────────────

function PlaywrightBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[#bae6fd] bg-[#f0f9ff] px-2 py-0.5 font-mono text-[10px] text-[#0369a1]">
      ⚡ Live Browser
    </span>
  )
}

// ── Checkout Analysis Section ─────────────────────────────────────────────────

function CheckoutAnalysisSection({ data }: { data: CheckoutAnalysis }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        Checkout analysis <PlaywrightBadge />
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
        Visual patterns <PlaywrightBadge />
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
              className="overflow-hidden border-[rgba(0,0,0,0.08)] bg-white shadow-none"
            >
              {p.evidenceScreenshot && (
                <img
                  src={p.evidenceScreenshot}
                  alt={`Evidence: ${p.type}`}
                  className="w-full border-b border-[rgba(0,0,0,0.06)] object-cover"
                  style={{ maxHeight: 180 }}
                />
              )}
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

// ── Action Card ───────────────────────────────────────────────────────────────

const VERDICT_CONFIG = {
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
              📸 live capture · Playwright · {getDomain(job.url)}
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

      {/* Product thumbnail — shown when recommending an alternative purchase */}
      {rec.ctaUrl && rec.ctaProductImageUrl && (
        <div className="bg-white px-5 pb-3">
          <div
            className="flex items-center gap-3 overflow-hidden rounded-xl border p-3"
            style={{ borderColor: "rgba(0,0,0,0.08)", background: "#fafaf8" }}
          >
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[rgba(0,0,0,0.08)] bg-white">
              <img
                src={rec.ctaProductImageUrl}
                alt="Product"
                className="h-full w-full object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = "none"
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-mono text-[9px] tracking-widest text-[#9ca3af] uppercase">
                As seen on {getDomain(job.url)}
              </div>
              <div className="mb-0.5 text-xs leading-snug font-semibold text-[#111111]">
                Same product
              </div>
              <div className="text-[11px] text-[#6b7280]">
                Available for less on{" "}
                {rec.ctaSubtext?.split("·")[0]?.trim() ?? "another site"}
              </div>
            </div>
          </div>
        </div>
      )}

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

function CleanReceiptSection({ data }: { data: SanitizedReceipt }) {
  const trustCfg =
    data.trustVerdict === "safe"
      ? { label: "Safe", color: GREEN, bg: "#d1fae5" }
      : data.trustVerdict === "sketchy"
        ? { label: "Sketchy", color: AMBER, bg: "#fef3c7" }
        : { label: "Skip", color: ACCENT, bg: "#fee2e2" }

  // Determine if we actually have real checkout data
  const hasRealPrice =
    data.truePrice && data.truePrice !== "unknown" && data.truePrice !== ""
  const hasRealFees =
    data.junkFeesStripped &&
    data.junkFeesStripped !== "$0.00" &&
    data.junkFeesStripped !== "0" &&
    data.junkFeesStripped !== "$0"
  const hasRealData = hasRealPrice || hasRealFees

  return (
    <Card className="overflow-hidden border-[rgba(0,0,0,0.08)] bg-white shadow-none">
      <div className="border-b border-[rgba(0,0,0,0.06)] bg-[#fafaf8] px-4 py-2">
        <span className="font-mono text-[10px] tracking-widest text-[#6b7280] uppercase">
          Clean receipt
        </span>
      </div>
      {!hasRealData ? (
        <CardContent className="p-4">
          <div className="flex items-start gap-3 rounded-lg border border-[rgba(0,0,0,0.08)] bg-[#fafaf8] p-3">
            <span className="mt-0.5 text-base">🛡️</span>
            <div>
              <p className="mb-0.5 text-xs font-semibold text-[#374151]">
                Checkout scan blocked by bot detection
              </p>
              <p className="text-[11px] leading-relaxed text-[#6b7280]">
                This site detected automated browsing and blocked the cart scan.
                The dark pattern analysis and trust score above are based on
                real data — only the checkout fee extraction was blocked.
              </p>
            </div>
          </div>
        </CardContent>
      ) : (
        <CardContent className="p-0">
          <div className="divide-y divide-[rgba(0,0,0,0.06)]">
            {hasRealFees && (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <span className="text-xs text-[#6b7280]">
                  Junk Fees Stripped
                </span>
                <span
                  className="font-mono text-sm font-bold"
                  style={{ color: GREEN }}
                >
                  {data.junkFeesStripped}
                </span>
              </div>
            )}
            {hasRealPrice && (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <span className="text-xs text-[#6b7280]">True Price</span>
                <span className="font-mono text-sm font-bold text-[#111111]">
                  {data.truePrice}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <span className="text-xs text-[#6b7280]">Trust Verdict</span>
              <Badge
                className="border-0 text-[10px] font-semibold"
                style={{ color: trustCfg.color, backgroundColor: trustCfg.bg }}
              >
                {trustCfg.label}
              </Badge>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function WholesaleBenchmarkSection({ data }: { data: WholesaleBenchmark }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
        <span className="h-3 w-[2px] rounded-full bg-[#ff4757]" />
        Wholesale benchmark
      </h3>
      <Card className="overflow-hidden border-[rgba(0,0,0,0.08)] bg-white shadow-none">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className="border-0 text-[10px] font-semibold"
              style={{ backgroundColor: BLUE + "18", color: BLUE }}
            >
              Est. wholesale {data.estimatedWholesalePrice}
            </Badge>
            {data.estimatedMarkupPercentage && (
              <Badge
                className="border-0 text-[10px] font-semibold"
                style={{ backgroundColor: ACCENT + "15", color: ACCENT }}
              >
                {data.estimatedMarkupPercentage} markup
              </Badge>
            )}
          </div>
          <div className="space-y-2">
            {data.benchmarks.map((b, i) => (
              <a
                key={i}
                href={b.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-[rgba(0,0,0,0.08)] px-3 py-2 hover:border-[rgba(0,0,0,0.18)]"
              >
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#111111]">
                    {b.source}
                  </span>
                  <span className="font-mono text-xs text-[#111111]">
                    {b.price}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11px] leading-relaxed text-[#6b7280]">
                  {b.productTitle}
                </p>
              </a>
            ))}
          </div>
          <p className="text-xs text-[#6b7280]">{data.summary}</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Result Detail ─────────────────────────────────────────────────────────────

function ResultDetail({ job }: { job: ScanJob }) {
  const result = job.result!
  const [showMore, setShowMore] = useState(false)
  const domain = getDomain(job.url)
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

  const verdictColor = getRiskColor(result.risk_score)

  return (
    <div
      className="space-y-4 rounded-2xl border-l-[3px] pl-5"
      style={{ borderColor: verdictColor }}
    >
      {/* ── CONTEXT HEADER — what was scanned ── */}
      <div className="flex items-center gap-3 border-b border-[rgba(0,0,0,0.07)] pb-4">
        <img
          src={favicon}
          alt=""
          className="h-9 w-9 shrink-0 rounded-xl border border-[rgba(0,0,0,0.08)]"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = "none"
          }}
        />
        <div className="min-w-0 flex-1">
          <div
            className="text-lg leading-tight font-black text-[#111111]"
            style={{
              fontFamily: "var(--font-display)",
              letterSpacing: "0.01em",
            }}
          >
            {domain}
          </div>
          {job.productQuery ? (
            <div className="mt-0.5 text-[12px] text-[#6b7280]">
              Scanned for{" "}
              <span className="font-semibold text-[#374151]">
                "{job.productQuery}"
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-[12px] text-[#9ca3af]">
              Full site scan
            </div>
          )}
        </div>
        {result.productImageUrl && (
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] bg-[#f4f4f2]">
            <img
              src={result.productImageUrl}
              alt="Product"
              className="h-full w-full object-contain"
              onError={(e) => {
                ;(e.target as HTMLImageElement).parentElement!.style.display =
                  "none"
              }}
            />
          </div>
        )}
      </div>

      {/* ── PRIMARY ACTION CARD ── */}
      {result.actionRecommendation ? (
        <ActionCard rec={result.actionRecommendation} job={job} />
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white px-5 py-4">
          <ArcGauge score={result.risk_score} size="sm" label="RISK" />
          {result.trustScore && (
            <ArcGauge
              score={result.trustScore.trust_score}
              size="sm"
              colorFn={getTrustColor}
              label="TRUST"
            />
          )}
          <div>
            <Badge
              className="verdict-stamp mb-1 border-0 px-3 py-1 text-sm font-bold"
              style={{
                backgroundColor: getRiskColor(result.risk_score) + "18",
                color: getRiskColor(result.risk_score),
                fontFamily: "var(--font-display)",
                letterSpacing: "0.05em",
                fontSize: "0.8rem",
              }}
            >
              {result.verdict.toUpperCase()}
            </Badge>
            <p className="text-xs text-[#6b7280]">
              {result.patterns.length} pattern
              {result.patterns.length !== 1 ? "s" : ""} detected
            </p>
          </div>
        </div>
      )}

      {result.sanitizedReceipt && (
        <CleanReceiptSection data={result.sanitizedReceipt} />
      )}

      {/* ── FEES / PATTERNS — visible by default ── */}
      {result.patterns.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
            <span className="h-3 w-[2px] rounded-full bg-[#ff4757]" />
            Fees & patterns detected
          </h3>
          <div className="space-y-3">
            {result.patterns.map((p, i) => (
              <PatternCard key={i} pattern={p} index={i} siteUrl={job.url} />
            ))}
          </div>
        </div>
      )}

      {/* ── TRUST SCORE — always shown when available ── */}
      {result.trustScore && <TrustScoreSection data={result.trustScore} />}

      {/* ── ETHICAL CONCERNS — always shown when available ── */}
      {result.ethicalAnalysis && (
        <EthicalAnalysisSection data={result.ethicalAnalysis} />
      )}

      {/* ── MARKETPLACE COMPARISON — streams in when ready ── */}
      {result.marketplaceComparisons && (
        <MarketplaceComparisonSection
          data={result.marketplaceComparisons}
          productQuery={job.productQuery}
          currentDomain={getDomain(job.url)}
        />
      )}

      {result.wholesaleBenchmark && (
        <WholesaleBenchmarkSection data={result.wholesaleBenchmark} />
      )}

      {/* ── MORE DETAILS — collapsed (price comparison, checkout, visuals, trace) ── */}
      {(result.profileComparison ||
        result.checkoutAnalysis ||
        result.visualDarkPatterns ||
        job.logs.length > 0) && (
        <>
          <button
            onClick={() => setShowMore((v) => !v)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(0,0,0,0.08)] bg-white py-2.5 text-xs font-medium text-[#6b7280] transition-colors hover:border-[rgba(0,0,0,0.2)]"
          >
            {showMore ? "↑ Less" : "↓ More details"}
          </button>

          {showMore && (
            <div className="space-y-6">
              {result.profileComparison && (
                <PriceComparisonSection data={result.profileComparison} />
              )}
              {result.checkoutAnalysis && (
                <CheckoutAnalysisSection data={result.checkoutAnalysis} />
              )}
              {result.visualDarkPatterns && (
                <VisualDarkPatternsSection data={result.visualDarkPatterns} />
              )}

              {/* Agent trace */}
              {job.logs.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-[#6b7280] uppercase">
                    <span className="h-3 w-[2px] rounded-full bg-[#ff4757]" />
                    Agent trace
                  </h3>
                  <div
                    className="log-scanline overflow-hidden rounded-xl"
                    style={{
                      background: "#0d0d0d",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.05)] px-4 py-2">
                      <ReticleMark size={11} />
                      <span className="font-mono text-[9px] tracking-widest text-[#4b5563]">
                        DARKWATCH AGENT
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                        <span className="font-mono text-[9px] text-[#10b981]">
                          {job.logs.length} STEPS
                        </span>
                      </span>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto p-4">
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
              )}
            </div>
          )}
        </>
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
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.url, productQuery: job.productQuery }),
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
            const event = JSON.parse(line.slice(6)) as ScanEvent
            if (event.type === "log") {
              const entry: LogEntry = {
                time: nowTime(),
                text: event.message,
                level: detectLogLevel(event.message),
              }
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id ? { ...j, logs: [...j.logs, entry] } : j
                )
              )
            } else if (event.type === "progress") {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id ? { ...j, progress: event.value } : j
                )
              )
            } else if (event.type === "stream_url") {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? {
                        ...j,
                        streamingUrls: [
                          ...j.streamingUrls,
                          { url: event.url, label: event.label },
                        ],
                      }
                    : j
                )
              )
            } else if (event.type === "browser_screenshot") {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? {
                        ...j,
                        liveScreenshots: (() => {
                          const streamId = event.streamId ?? "main"
                          const existing = j.liveScreenshots.find(
                            (s) => s.streamId === streamId
                          )
                          const next: LiveScreenshotEntry = {
                            streamId,
                            label: event.label,
                            dataUrl: event.dataUrl,
                          }
                          return existing
                            ? j.liveScreenshots.map((s) =>
                                s.streamId === streamId ? next : s
                              )
                            : [...j.liveScreenshots, next]
                        })(),
                      }
                    : j
                )
              )
            } else if (event.type === "trust_check") {
              setJobs((prev) =>
                prev.map((j) => {
                  if (j.id !== job.id) return j
                  const existing = j.trustChecks.find(
                    (c) => c.source === event.source
                  )
                  const updated: TrustCheckEntry = {
                    source: event.source,
                    status: event.status,
                    finding: event.finding,
                  }
                  return {
                    ...j,
                    trustChecks: existing
                      ? j.trustChecks.map((c) =>
                          c.source === event.source ? updated : c
                        )
                      : [...j.trustChecks, updated],
                  }
                })
              )
            } else if (event.type === "update") {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id && j.result
                    ? { ...j, result: { ...j.result, ...event.data } }
                    : j
                )
              )
            } else if (event.type === "result") {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? {
                        ...j,
                        status: "done",
                        result: event.data,
                        progress: 100,
                      }
                    : j
                )
              )
            } else if (event.type === "error") {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? { ...j, status: "error", error: event.message }
                    : j
                )
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
      streamingUrls: [],
      liveScreenshots: [],
      trustChecks: [],
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
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(0,0,0,0.07) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
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
            <DarkwatchLogo size="md" />
          </div>

          {/* Hero content */}
          <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 pt-16">
            <div className="mt-40 mb-10 text-center">
              {/* Eyebrow */}
              {/* <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(0,0,0,0.08)] bg-white/80 px-3 py-1 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4757]" />
                <span className="text-[11px] font-semibold tracking-widest text-[#6b7280] uppercase">
                  AI Shopping Bodyguard
                </span>
              </div> */}
              <h1
                className="mb-4 text-[3.8rem] leading-[0.95] font-black tracking-tight text-[#111111]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                NEVER GET
                <br />
                <span style={{ color: ACCENT }}>RIPPED OFF</span> AGAIN.
              </h1>
              <p className="mx-auto max-w-sm text-base leading-relaxed text-[#6b7280]">
                Paste any store URL. Our AI browses it like a real shopper —
                finding hidden fees, fake reviews, and dark patterns before you
                pay.
              </p>
            </div>

            {/* Input card */}
            <div className="w-full max-w-md">
              <div
                className="rounded-2xl border border-[rgba(0,0,0,0.1)] bg-white p-2 shadow-sm"
                style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}
              >
                <div className="mb-2 flex gap-2">
                  <Input
                    placeholder="e.g. shein.com, amazon.com/dp/..."
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value)
                      if (urlError) setUrlError("")
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleScan()}
                    className={`h-11 flex-1 border-[rgba(0,0,0,0.1)] bg-[#fafaf8] text-[#111111] placeholder:text-[#9ca3af] focus:border-[#111111] focus:bg-white ${
                      urlError ? "border-[#ff4757]" : ""
                    }`}
                  />
                  <Button
                    onClick={handleScan}
                    className="h-11 rounded-xl px-5 text-sm font-black tracking-wide text-white"
                    style={{
                      backgroundColor: ACCENT,
                      fontFamily: "var(--font-display)",
                      fontSize: "0.95rem",
                      letterSpacing: "0.04em",
                    }}
                  >
                    EXPOSE →
                  </Button>
                </div>
                <Input
                  placeholder="Product you're searching for (e.g. running shoes, Kindle case)"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  className="h-10 border-[rgba(0,0,0,0.08)] bg-[#fafaf8] text-sm text-[#111111] placeholder:text-[#9ca3af] focus:border-[#111111] focus:bg-white"
                />
              </div>
              {urlError && (
                <p className="mt-1.5 ml-1 text-xs text-[#ff4757]">{urlError}</p>
              )}

              {/* Trust signal row */}
              <div className="mt-4 flex items-center justify-center gap-4">
                {[
                  { icon: "🔒", label: "No account needed" },
                  { icon: "⚡", label: "Results in ~90s" },
                  { icon: "🤖", label: "GPT-4o powered" },
                ].map(({ icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="text-sm">{icon}</span>
                    <span className="text-[11px] font-medium text-[#9ca3af]">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer credit */}
          <div className="absolute right-8 bottom-6 z-20">
            <div className="flex items-center gap-2 rounded-xl border border-[rgba(0,0,0,0.08)] bg-white/85 px-3 py-2 backdrop-blur-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/image.png"
                alt="Aditya Rane"
                className="h-7 w-7 rounded-full border border-[rgba(0,0,0,0.1)] object-cover"
              />
              <p className="text-[11px] font-medium text-[#374151]">
                Built by{" "}
                <span className="font-semibold text-[#111111]">
                  Aditya Rane
                </span>
              </p>

              <div className="flex items-center gap-2">
                <a
                  href="https://www.linkedin.com/in/adityavrane/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="rounded-md border border-[rgba(0,0,0,0.1)] bg-white p-1.5 text-[#6b7280] transition-colors hover:text-[#111111]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M19 3A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H19ZM8.05 10.55H5.56V18H8.05V10.55ZM6.8 6.58C6 6.58 5.45 7.11 5.45 7.81C5.45 8.5 6 9.04 6.77 9.04H6.79C7.61 9.04 8.12 8.5 8.12 7.81C8.11 7.11 7.61 6.58 6.8 6.58ZM18.44 13.77C18.44 11.29 17.12 10.13 15.36 10.13C13.94 10.13 13.3 10.9 12.94 11.45V10.55H10.45C10.48 11.15 10.45 18 10.45 18H12.94V13.84C12.94 13.62 12.96 13.4 13.02 13.24C13.2 12.8 13.6 12.34 14.28 12.34C15.17 12.34 15.53 13.02 15.53 14.01V18H18.02V13.72L18.44 13.77Z" />
                  </svg>
                </a>

                <a
                  href="https://github.com/adityaavr"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  className="rounded-md border border-[rgba(0,0,0,0.1)] bg-white p-1.5 text-[#6b7280] transition-colors hover:text-[#111111]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 2C6.48 2 2 6.59 2 12.25C2 16.78 4.87 20.62 8.84 21.98C9.34 22.08 9.52 21.76 9.52 21.49C9.52 21.25 9.51 20.45 9.51 19.59C6.73 20.21 6.14 18.38 6.14 18.38C5.68 17.17 5.03 16.84 5.03 16.84C4.12 16.2 5.1 16.21 5.1 16.21C6.1 16.28 6.63 17.26 6.63 17.26C7.52 18.82 8.97 18.38 9.54 18.12C9.63 17.46 9.89 17.01 10.17 16.75C7.95 16.49 5.62 15.61 5.62 11.67C5.62 10.55 6.01 9.64 6.66 8.92C6.56 8.66 6.22 7.61 6.76 6.19C6.76 6.19 7.6 5.91 9.5 7.24C10.3 7.01 11.15 6.9 12 6.9C12.85 6.9 13.7 7.01 14.5 7.24C16.4 5.91 17.24 6.19 17.24 6.19C17.78 7.61 17.44 8.66 17.34 8.92C17.99 9.64 18.38 10.55 18.38 11.67C18.38 15.62 16.04 16.49 13.82 16.74C14.17 17.06 14.48 17.68 14.48 18.63C14.48 19.98 14.47 21.07 14.47 21.49C14.47 21.76 14.65 22.09 15.16 21.98C19.13 20.62 22 16.78 22 12.25C22 6.59 17.52 2 12 2Z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        // ── ACTIVE (bento grid) ───────────────────────────────────────────────
        <motion.div
          key="active"
          className="min-h-screen bg-[#fafaf8]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(0,0,0,0.055) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Compact sticky header — logo + scan inputs */}
          <div className="sticky top-0 z-50 border-b border-[rgba(0,0,0,0.08)] bg-white/95 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
              <DarkwatchLogo size="sm" />
              <div className="ml-auto flex w-full max-w-xl gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    placeholder="Store URL…"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value)
                      if (urlError) setUrlError("")
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleScan()}
                    className={`h-9 border-[rgba(0,0,0,0.12)] bg-[#fafaf8] text-sm text-[#111111] placeholder:text-[#9ca3af] focus:border-[#111111] ${
                      urlError ? "border-[#ff4757]" : ""
                    }`}
                  />
                </div>
                <div className="hidden min-w-0 flex-1 sm:block">
                  <Input
                    placeholder="Product (optional)…"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleScan()}
                    className="h-9 border-[rgba(0,0,0,0.12)] bg-[#fafaf8] text-sm text-[#111111] placeholder:text-[#9ca3af] focus:border-[#111111]"
                  />
                </div>
                <Button
                  onClick={handleScan}
                  className="h-9 shrink-0 px-5 font-black text-white"
                  style={{
                    backgroundColor: ACCENT,
                    fontFamily: "var(--font-display)",
                    fontSize: "0.9rem",
                    letterSpacing: "0.04em",
                  }}
                >
                  EXPOSE →
                </Button>
              </div>
              <Button
                variant="ghost"
                onClick={handleClear}
                className="h-9 shrink-0 px-2 text-xs text-[#9ca3af] hover:text-[#111111]"
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

              {/* Live multi-browser wall */}
              {(() => {
                const liveFeeds = jobs
                  .filter((j) => j.status === "scanning")
                  .flatMap((j) =>
                    j.liveScreenshots.map((s) => ({
                      key: `${j.id}-${s.streamId}`,
                      label: s.label,
                      dataUrl: s.dataUrl,
                    }))
                  )

                if (liveFeeds.length === 0) return null

                return (
                  <AnimatePresence>
                    <motion.div
                      key="live-playwright-multi"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                      className="mt-4 overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] bg-[#0a0a0a]"
                    >
                      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
                        <span
                          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#ff4757]"
                          style={{ boxShadow: "0 0 6px #ff4757" }}
                        />
                        <span className="truncate font-mono text-[10px] tracking-widest text-[#9ca3af]">
                          LIVE PLAYWRIGHT WALL · {liveFeeds.length} AGENT
                          {liveFeeds.length !== 1 ? "S" : ""}
                        </span>
                        <span className="ml-auto font-mono text-[9px] text-[#4b5563]">
                          REAL-TIME
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
                        {liveFeeds.map((feed) => (
                          <div
                            key={feed.key}
                            className="overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)]"
                          >
                            <div className="truncate border-b border-[rgba(255,255,255,0.06)] px-2 py-1 font-mono text-[9px] tracking-wider text-[#9ca3af]">
                              {feed.label}
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={feed.dataUrl}
                              alt={feed.label}
                              className="block w-full"
                              style={{
                                maxHeight: 240,
                                objectFit: "cover",
                                objectPosition: "top",
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                )
              })()}

              {/* Trust intelligence panel — shows while trust check is running */}
              {(() => {
                const activeTrustChecks = jobs
                  .filter((j) => j.status === "scanning")
                  .flatMap((j) => j.trustChecks)
                return activeTrustChecks.length > 0 ? (
                  <div className="mt-3">
                    <TrustIntelPanel checks={activeTrustChecks} />
                  </div>
                ) : null
              })()}

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
