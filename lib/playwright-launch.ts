import { chromium } from "playwright"
import type { Browser } from "playwright"

type LaunchOptions = {
  args?: string[]
}

export async function launchPlaywrightBrowser(
  options?: LaunchOptions
): Promise<Browser> {
  const extraArgs = options?.args ?? []

  if (process.env.VERCEL) {
    const chromiumPack = await import("@sparticuz/chromium")
    const executablePath = await chromiumPack.default.executablePath()
    const args = [...chromiumPack.default.args, ...extraArgs]

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
