import { chromium } from "playwright-core"
import type { Browser } from "playwright-core"

type LaunchOptions = {
  args?: string[]
}

let serverlessExecutablePathPromise: Promise<string> | null = null

async function getServerlessExecutablePath(): Promise<string> {
  if (!serverlessExecutablePathPromise) {
    serverlessExecutablePathPromise = (async () => {
      const chromiumPack = await import("@sparticuz/chromium")
      const path = await chromiumPack.default.executablePath()
      if (!path) {
        throw new Error(
          "Serverless Chromium executable path was not resolved on this runtime."
        )
      }
      return path
    })()
  }
  return serverlessExecutablePathPromise
}

function mergeArgs(primary: string[], secondary: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of [...primary, ...secondary]) {
    if (seen.has(a)) continue
    seen.add(a)
    out.push(a)
  }
  return out
}

export async function launchPlaywrightBrowser(
  options?: LaunchOptions
): Promise<Browser> {
  const extraArgs = options?.args ?? []
  const wsEndpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim()

  if (wsEndpoint) {
    return chromium.connect(wsEndpoint)
  }

  const shouldUseServerlessChromium =
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_ENV) ||
    process.env.AWS_EXECUTION_ENV !== undefined ||
    process.platform === "linux"

  if (shouldUseServerlessChromium) {
    if (process.env.VERCEL === "1") {
      throw new Error(
        "Playwright local Chromium is unavailable on this Vercel runtime (missing system libs like libnss3). Set BROWSERLESS_WS_ENDPOINT to a remote browser (Browserless) or run browser jobs on a separate worker service."
      )
    }

    const chromiumPack = await import("@sparticuz/chromium")
    const executablePath = await getServerlessExecutablePath()
    const args = mergeArgs(chromiumPack.default.args, extraArgs)

    return chromium.launch({
      headless: true,
      executablePath,
      args,
    })
  }

  return chromium.launch({
    headless: true,
    args: extraArgs,
  })
}
