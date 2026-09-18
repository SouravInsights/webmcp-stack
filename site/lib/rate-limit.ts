/**
 * A per-IP sliding-window rate limit for the public API routes.
 *
 * In-memory on purpose: these routes serve a free demo tier, so a restarted
 * instance forgetting its counters is a fine trade for zero infrastructure.
 * The real backstop is the upstream key's own credit limit.
 */

export interface RateLimitOptions {
  windowMs: number;
  /** Requests allowed per window, per IP. */
  max: number;
}

export interface RateLimiter {
  /** True when this request is over the limit. Counts the request either way. */
  limited(request: Request): boolean;
}

export function createRateLimiter({ windowMs, max }: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    limited(request: Request): boolean {
      // Proxies set x-forwarded-for; the first entry is the client.
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const now = Date.now();
      const recent = (hits.get(ip) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= max) return true;
      recent.push(now);
      hits.set(ip, recent);
      return false;
    },
  };
}
