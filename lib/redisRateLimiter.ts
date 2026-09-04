// =========================================
// Redis-backed sliding-window rate limiter.
//
// Drop-in replacement for the in-memory SlidingWindowRateLimiter.
// Shares state across ALL app instances so a user can't bypass the
// limit by hitting a different server behind the load balancer.
//
// Falls back to in-memory if Redis is unavailable (degraded but
// never fully down).
// =========================================

import Redis from "ioredis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
      enableReadyCheck: true,
    });
    redis.connect().catch(() => {
      console.warn("⚠️ Redis connect failed — falling back to in-memory rate limiter");
      redis = null;
    });
  }
  return redis;
}

// --- In-memory fallback (identical logic to the original) ---
class InMemoryFallback {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    this.sweepIfLarge();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.maxRequests) {
      this.hits.set(key, arr);
      const oldest = arr[0];
      return { allowed: false, retryAfterMs: Math.max(1, this.windowMs - (now - oldest)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { allowed: true, retryAfterMs: 0 };
  }

  private sweepIfLarge(): void {
    if (this.hits.size < 10000) return;
    const now = Date.now();
    for (const [key, arr] of this.hits) {
      const live = arr.filter((t) => now - t < this.windowMs);
      if (live.length === 0) this.hits.delete(key);
      else this.hits.set(key, live);
    }
  }
}

// ---------------------------------------------------------------
// Redis sliding-window implementation using sorted sets.
//
// Key pattern:  `ratelimit:{prefix}:{identifier}`
// Each entry is a sorted set scored by timestamp (ms).
// TTL = windowMs so Redis auto-expires old keys.
// ---------------------------------------------------------------
export class RedisSlidingWindowRateLimiter {
  private fallback: InMemoryFallback;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly prefix = "default"
  ) {
    this.fallback = new InMemoryFallback(maxRequests, windowMs);
  }

  async check(identifier: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const r = getRedis();
    if (!r) return this.fallback.check(identifier);

    const key = `ratelimit:${this.prefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    try {
      const pipeline = r.pipeline();
      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      // Count current entries in window
      pipeline.zcard(key);
      // Add current request
      pipeline.zadd(key, String(now), `${now}:${Math.random().toString(36).slice(2, 8)}`);
      // Set TTL so key auto-cleans
      pipeline.expire(key, Math.ceil(this.windowMs / 1000));

      const results = await pipeline.exec();
      if (!results) return this.fallback.check(identifier);

      const count = (results[1][1] as number) || 0;

      if (count >= this.maxRequests) {
        // Over limit — remove the entry we just added
        await r.zrem(key, `${now}:${Math.random().toString(36).slice(2, 8)}`).catch(() => {});
        // Find oldest to compute retry-after
        const oldest = await r.zrange(key, 0, 0, "WITHSCORES");
        const oldestTs = oldest.length >= 2 ? Number(oldest[1]) : now;
        return {
          allowed: false,
          retryAfterMs: Math.max(1, this.windowMs - (now - oldestTs)),
        };
      }

      return { allowed: true, retryAfterMs: 0 };
    } catch (err) {
      console.warn("⚠️ Redis rate limiter error, falling back to in-memory:", err);
      return this.fallback.check(identifier);
    }
  }
}
