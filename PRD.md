**DarkWatch — Product Requirements Document (v1.0)**

**What it is:** An AI-powered web app that scans any URL for deceptive UX tactics, trust signals, ethical concerns, and price discrimination — streamed in real time.

**Core pillars:**

1. **Dark Pattern Detection** — Visits pages twice (8s gap) to catch fake countdown timers that reset on reload. Detects 10 pattern types (scarcity, social proof, confirmshaming, subscription traps, etc.) via Gemini 2.5 Flash with strict evidence requirements.

2. **Trust Score** — Fetches Trustpilot, sends to Gemini, returns 0–100 score + verdict (trusted/caution/suspicious/dangerous).

3. **Ethical Analysis** — Fetches privacy policy, ToS, and about pages. Gemini assesses 6 dimensions: Data Privacy, Environmental, Labor, Business Practices, Transparency, Consumer Rights.

4. **Price Discrimination** — Hits the same URL with 4 browser profiles (Mobile SG baseline, Desktop US, no cookies, return visitor) simultaneously, flags price divergence.

5. **Real-Time Streaming** — SSE stream from `/api/scan` shows live agent trace as it works.

**Stack:** Next.js 16 + Bun + Gemini 2.5 Flash + COBE globe + shadcn/ui + Tailwind v4, deployed on Vercel.

**Key limitations documented:** No persistence, static HTML only (SPAs partially analyzed), trust sources often Cloudflare-blocked (Gemini falls back to training knowledge), mock live feed on landing.

**Swap-ready for demo day:** TinyFish (full JS rendering), OpenAI GPT-4o, Claude SDK — all stubbed in code behind flags.