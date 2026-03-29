import { chromium } from "playwright-core"
import type { Browser } from "playwright-core"

type LaunchOptions = {
  args?: string[]
}

export async function launchPlaywrightBrowser(
  options?: LaunchOptions
): Promise<Browser> {
  const extraArgs = options?.args ?? []

  const shouldUseServerlessChromium =
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_ENV) ||
    process.env.AWS_EXECUTION_ENV !== undefined ||
    process.platform === "linux"

  if (shouldUseServerlessChromium) {
    const chromiumPack = await import("@sparticuz/chromium")
    const executablePath = await chromiumPack.default.executablePath()
    const args = [...chromiumPack.default.args, ...extraArgs]

    if (!executablePath) {
      throw new Error(
        "Serverless Chromium executable path was not resolved on this runtime."
      )
    }

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
