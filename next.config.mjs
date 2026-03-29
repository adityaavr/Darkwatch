/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Next.js/Turbopack not to bundle these — they're native Node.js packages
  // that must be required at runtime, not compiled by the bundler.
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "playwright-extra",
    "puppeteer-extra-plugin-stealth",
    "@sparticuz/chromium",
  ],
  outputFileTracingIncludes: {
    "/api/scan": [
      "./node_modules/playwright-core/.local-browsers/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/clean-cart": [
      "./node_modules/playwright-core/.local-browsers/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/marketplace-retry": [
      "./node_modules/playwright-core/.local-browsers/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
}

export default nextConfig
