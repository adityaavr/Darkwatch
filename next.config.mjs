/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Next.js/Turbopack not to bundle these — they're native Node.js packages
  // that must be required at runtime, not compiled by the bundler.
  serverExternalPackages: [
    'playwright',
    'playwright-core',
    'playwright-extra',
    'puppeteer-extra-plugin-stealth',
  ],
}

export default nextConfig
