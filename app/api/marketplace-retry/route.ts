import { NextRequest } from "next/server"
import { retryMarketplaceSlowMode } from "@/lib/marketplace-comparison"

export const maxDuration = 180

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const query = typeof body.query === "string" ? body.query.trim() : ""
    const currentDomain =
      typeof body.currentDomain === "string" ? body.currentDomain.trim() : ""
    const marketplace =
      typeof body.marketplace === "string" ? body.marketplace.trim() : ""

    if (!query || !currentDomain || !marketplace) {
      return new Response(
        JSON.stringify({
          error: "query, currentDomain and marketplace are required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const result = await retryMarketplaceSlowMode(
      query,
      currentDomain,
      marketplace,
      () => {
        // no-op for now; scan page already has global logs
      }
    )

    if (!result) {
      return new Response(
        JSON.stringify({ error: "Marketplace not in competitor set" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Retry failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
