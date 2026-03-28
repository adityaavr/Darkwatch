# Darkwatch

**AI-powered dark pattern detection. Paste a URL, see every manipulation tactic in seconds.**

Dark patterns are design tricks that websites use to get you to spend more, sign up for things you didn't want, or act under pressure that isn't real. Darkwatch surfaces them automatically.

---

## Live demo

> [darkwatch.vercel.app](https://darkwatch.vercel.app)

---

## The problem

Most dark pattern scanners look at HTML structure. They miss the most common tricks because those tricks only reveal themselves through behavior — a countdown timer that resets when you reload the page looks identical to a real one in the source code.

Darkwatch visits pages like a real user would. Twice.

---

## How it works

1. Visits the URL and captures the page
2. Waits 8 seconds, then visits again
3. Compares the two snapshots — if a countdown timer is *higher* on the second visit, it reset. That's a confirmed fake.
4. Sends the full behavioral profile to AI for classification
5. Streams results back to you live as the agent works

Everything happens in real time. You watch the agent think.

---

## What it catches

- **Fake countdown timers** — resets on reload to manufacture urgency
- **Artificial scarcity** — "only 3 left" on products sold by millions
- **Fake social proof** — "47 people viewing this right now" with no source
- **False urgency** — specific deadlines that don't exist ("offer expires tonight")
- **Confirmshaming** — guilt-trip decline buttons ("No thanks, I hate saving money")
- **Hidden costs** — prices that grow between the listing and checkout
- **Subscription traps** — easy sign-up, impossible cancellation
- **Misleading defaults** — pre-checked boxes for things you didn't ask for
- **Trick questions** — double-negative opt-out language designed to confuse

---

## Built with

- [Next.js 15](https://nextjs.org) · [TypeScript](https://typescriptlang.org) · [Bun](https://bun.sh)
- [Gemini 2.5 Flash](https://deepmind.google/technologies/gemini/) for AI classification
- [COBE](https://cobe.vercel.app) for the WebGL globe
- [Framer Motion](https://www.framer.com/motion/) · [shadcn/ui](https://ui.shadcn.com)

---

## Run it yourself

```bash
git clone https://github.com/adityaavr/darkwatch
cd darkwatch
bun install
```

Create a `.env.local` file:

```
GEMINI_API_KEY=your_key_here
```

Get a free Gemini API key at [aistudio.google.com](https://aistudio.google.com).

```bash
bun dev
```

Open [localhost:3000](http://localhost:3000).

---

## License

MIT
