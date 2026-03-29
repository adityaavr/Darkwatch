export async function GET() {
  const key = process.env.OPENAI_API_KEY
  const masked = key ? `${key.slice(0, 3)}...${key.slice(-4)}` : null

  return new Response(
    JSON.stringify(
      {
        ok: Boolean(key && key.trim().length > 0),
        vercelEnv: process.env.VERCEL_ENV ?? null,
        nodeEnv: process.env.NODE_ENV ?? null,
        openAiKeyPresent: Boolean(key),
        openAiKeyTrimmedLength: key ? key.trim().length : 0,
        openAiKeyPreview: masked,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  )
}
