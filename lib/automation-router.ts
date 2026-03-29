import OpenAI from "openai"
import type { MarketplaceRecoveryPlan } from "./types"

type RecoveryInput = {
  marketplace: string
  status: "blocked" | "unverified"
  note: string
}

function fallbackPlans(inputs: RecoveryInput[]): MarketplaceRecoveryPlan[] {
  return inputs.map((i) => {
    if (i.status === "unverified") {
      return {
        marketplace: i.marketplace,
        status: i.status,
        nextAction: "retry-slow",
        reason:
          "Page loaded but price extraction failed; retry with slower interaction.",
        checklist: [
          "Run slow-mode retry for this marketplace.",
          "If still no price, open listing and manually confirm.",
        ],
        confidence: 74,
      }
    }

    return {
      marketplace: i.marketplace,
      status: i.status,
      nextAction: "handoff-human",
      reason:
        "Human verification wall detected; use user checkpoint instead of bypass.",
      checklist: [
        "Open listing in user browser and complete verification.",
        "Capture visible price and attach manual verification evidence.",
      ],
      confidence: 83,
    }
  })
}

export async function planMarketplaceRecovery(
  query: string,
  inputs: RecoveryInput[],
  onLog?: (msg: string) => void
): Promise<MarketplaceRecoveryPlan[]> {
  if (inputs.length === 0) return []

  if (!process.env.OPENAI_API_KEY) {
    onLog?.("Recovery planner: OPENAI_API_KEY missing, using rule fallback.")
    return fallbackPlans(inputs)
  }

  try {
    onLog?.("Recovery planner: generating next-best safe actions...")
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const prompt = `You are an automation reliability planner for e-commerce price intelligence.

Objective:
- Produce practical, compliant next steps when automation cannot capture data.
- DO NOT suggest bypassing CAPTCHAs, defeating anti-bot protections, forging browser fingerprints, or evasion tactics.
- Prefer actions: retry-slow, handoff-human, switch-source, defer.

Product query: ${query}
Blocked/unverified inputs:
${JSON.stringify(inputs, null, 2)}

Return ONLY valid JSON:
{
  "plans": [
    {
      "marketplace": "string",
      "status": "blocked|unverified",
      "nextAction": "retry-slow|handoff-human|switch-source|defer",
      "reason": "<=120 chars",
      "checklist": ["2-3 concise steps"],
      "confidence": 0
    }
  ]
}`

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 550,
    })

    const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as {
      plans?: MarketplaceRecoveryPlan[]
    }

    const plans = parsed.plans ?? []
    if (!Array.isArray(plans) || plans.length === 0)
      return fallbackPlans(inputs)

    const byName = new Map(plans.map((p) => [p.marketplace, p]))
    return inputs.map((i) => {
      const p = byName.get(i.marketplace)
      if (!p) return fallbackPlans([i])[0]
      return {
        marketplace: i.marketplace,
        status: i.status,
        nextAction: p.nextAction,
        reason: p.reason,
        checklist: Array.isArray(p.checklist) ? p.checklist.slice(0, 3) : [],
        confidence:
          typeof p.confidence === "number"
            ? Math.max(0, Math.min(100, Math.round(p.confidence)))
            : 65,
      }
    })
  } catch {
    onLog?.("Recovery planner unavailable; using rule fallback.")
    return fallbackPlans(inputs)
  }
}
