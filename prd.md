# 🛡️ DarkWatch: Product Requirements Document (PRD)

**Project Name:** DarkWatch v3 (The Autonomous Cart Cleanser)
**Tagline:** "Your AI bodyguard for a hostile web. We strip the BS, you get the real price."
**Core Value:** Defeating dark patterns not by warning the user, but by actively disarming the traps, dismissing the pop-ups, unchecking the junk fees, and serving a sanitized checkout experience.

### 1. Vision & Differentiation
The modern e-commerce web is heavily militarized against consumers with fake countdowns, un-rejectable cookie banners, forced upsells, and pre-checked shipping insurances. 
*   **Previous Solutions (e.g., TinyDetective):** Passive. Analyzes listings to build reports for authorities. 
*   **DarkWatch:** Active. Acts as a proxy browser. It traverses the hostile environment so the user doesn’t have to, sanitizes the transaction, and protects the user’s wallet.

### 2. The Core User Journey
1.  **The Drop:** The user pastes a chaotic product URL (e.g., a shady dropshipping site or aggressive fast-fashion retailer) into the DarkWatch dashboard.
2.  **The Watchtower (Live Execution Trace):** A terminal-style UI expands. Through a Server-Sent Events (SSE) stream, the user watches the TinyFish agent work live:
    *   *System: Bypassing anti-bot verification...*
    *   *System: 3 Pop-ups detected. Actively rejecting all.*
    *   *System: Adding product to cart. Proceeding to checkout phase.*
    *   *AI Vision: Identified hidden $3.99 'Package Protection' checkbox.*
    *   *Action: Un-checking hidden fee.*
3.  **The Clean Reveal:** The screen transitions from the messy log terminal to an ultra-clean, minimalist "Stripe-style" receipt.
4.  **The Delta Summary:** The receipt shows the "Advertised Price" versus the "Hostile Cart Price", highlighting the exact junk fees the agent successfully stripped out. It displays the final, sanitized "True Cost."

### 3. Key Deliverables for Demo Day
*   **Sleek Ingestion UI:** A beautifully animated input screen.
*   **Live SSE Log Terminal:** Critical for hackathon presentation to prove the AI is actively browsing, not just loading a static database.
*   **Multimodal AI Fee Sanitizer:** Combining screenshot vision and active DOM clicking to remove dark patterns.
*   **Sanitized Receipt UI:** The polished final state that delivers the satisfying "Aha!" moment to the judges.

---

# ⚙️ Technical Specification (Tech Spec)

### 1. Technology Stack
*   **Runtime Engine:** Bun (chosen for hyper-fast execution, native TypeScript support, and low latency for the backend logic).
*   **Web Framework:** Next.js 16 (React) for both the frontend UI and the API/Edge routing for the data streams.
*   **Styling:** Tailwind CSS + shadcn/ui for rapid, beautiful, accessible component design (Dark Mode default).
*   **AI Orchestration:** Vercel `ai-sdk` (for standardizing tool calls, structured object generation, and streaming text responses).
*   **Browser/Agent Infrastructure:** TinyFish API (handles complex multi-step navigation, rendering, anti-bot circumvention, and executing physical clicks).
*   **Intelligence:** OpenAI GPT-4o (specifically utilizing its Vision capabilities for layout analysis, alongside its standard text-reasoning for HTML parsing).

### 2. System Architecture & Flow

**Phase A: Ingestion & Connection**
When the Next.js frontend submits the URL, it opens a Server-Sent Events connection to the Bun/Next.js backend. This allows the backend to stream updates token-by-token or step-by-step without waiting for the entire 20-40 second browser interaction to complete.

**Phase B: The TinyFish Action Pipeline**
The backend uses `ai-sdk` to trigger a sequence of actions via TinyFish.
1.  **Arrival & Perimeter Breach:** TinyFish navigates to the URL. It is instructed to reject any GDPR/Cookie banners. `ai-sdk` streams an update back to the client UI terminal.
2.  **Extraction & Addition:** TinyFish identifies the primary "Add to Cart" button, reads the advertised base price, and clicks the button. It waits for the cart drawer or redirect to settle.
3.  **Checkout Navigation:** TinyFish traverses to the final pre-payment checkout screen where dark patterns usually hide. 
4.  **Visual Sweep (The Multimodal Step):** TinyFish captures a viewport screenshot of the checkout form. 
5.  **Sanitization Logic:** The image is passed to GPT-4o Vision via `ai-sdk`. The AI evaluates the layout, specifically looking for pre-checked boxes labeled "Insurance," "Priority Processing," or "Tips." 
6.  **Disarmament:** If Vision detects a trap, `ai-sdk` outputs a structured command to TinyFish specifying the exact UI element to un-check or remove. TinyFish executes the click.
7.  **Final Tally:** TinyFish reads the final cart total post-sanitization.

**Phase C: Output Generation**
The backend compiles the original scraped price, the list of disarmed dark patterns, the rejected fees, and the final sanitized price into a structured data format. The SSE stream sends a specific termination signal with this payload, causing the frontend UI to transition into the "Clean Checkout Receipt" view.

### 3. API & AI Integration Strategies

*   **Vercel AI SDK Strategy:** Utilize the structured output capabilities of `ai-sdk`. Rather than relying on raw text, force GPT-4o to return strict schemas that define whether a junk fee was found, its monetary value, and a brief description.
*   **Vision-to-Action Handoff:** Since TinyFish needs to know *what* to click, the prompt to GPT-4o Vision must ask for the textual label or contextual surrounding text of the junk-fee checkbox. The backend then maps this text to a TinyFish command to target that specific text label and trigger a click event.

### 4. Demo Day "Stubbing" Strategy (Hackathon Optimization)
Since e-commerce sites update their layouts constantly, running a fully blind zero-shot AI on an untested website live on stage is too high-risk for a 2-day build.
*   **The Safe Path:** Pick two specific, notorious e-commerce URLs before the presentation. Pre-tune your `ai-sdk` prompts and TinyFish interaction steps to flawlessly handle the exact cookie banners, pop-ups, and cart structures of those two domains.
*   **The Demo Illusion:** On stage, the audience will see the input field, the complex streaming logs, the live visual analysis, and the final result working perfectly on those sites. 
*   **Graceful Failures:** If a judge asks you to run an untested URL, ensure your architecture has a graceful timeout that still renders the UI, but states: "Agent reached checkout but could not verify visual integrity of the layout." This proves the system is resilient. 

### 5. Division of Labor (2-Day Sprint Plan)
*   **Teammate 1 (Frontend & Illusion):** Setup Next.js, shadcn UI, and build the two core states: The "Hacker Terminal / SSE Stream View" and the "Clean Stripe Receipt View." Ensure the animations are smooth.
*   **Teammate 2 (The TinyFish Wrangler):** Focus entirely on the Bun backend script that talks to TinyFish. Map out the exact commands to click 'Add to Cart', bypass the specific site pop-ups, and get to the checkout screen.
*   **Teammate 3 (The Brains):** Integrate `ai-sdk` and OpenAI Vision. Take manual screenshots of carts, figure out the exact prompt needed for GPT-4o Vision to spot the fake insurance fees, and ensure it returns clean, parseable data to hand back to Teammate 2.
*   

