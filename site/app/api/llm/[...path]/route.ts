/**
 * The free hosted tier for the codegen CLI's LLM features. The OpenRouter
 * key lives here, server-side — never in the published package, where it
 * would be public within hours.
 *
 * Abuse posture: per-IP rate limit, a hard cap on response tokens, a fixed
 * cheap model the caller cannot override, and the upstream key itself has a
 * hard credit limit on the OpenRouter dashboard as the backstop. The key can
 * only spend what that limit allows.
 */

import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** The model every hosted request uses. Callers do not get a choice. */
const MODEL = "openai/gpt-4o-mini";
/** Per-request ceiling on generated tokens. Tool metadata is small. */
const MAX_TOKENS = 2048;
/** Sliding-window per-IP rate limit. */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const limiter = createRateLimiter({ windowMs: WINDOW_MS, max: MAX_REQUESTS_PER_WINDOW });

interface ChatRequest {
  messages?: { role: string; content: string }[];
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The hosted tier is not configured. Add your own API key instead." },
      { status: 503 },
    );
  }

  if (limiter.limited(request)) {
    return NextResponse.json(
      { error: "Free tier rate limit reached. Add your own API key to keep going." },
      { status: 429 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages is required." }, { status: 400 });
  }

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: body.messages,
      max_tokens: MAX_TOKENS,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const payload = await upstream.json();
  return NextResponse.json(payload, { status: upstream.status });
}
