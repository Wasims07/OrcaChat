// =========================================
// Redis-backed response cache for chat completions.
//
// Replaces the in-memory Map so cached responses are shared across
// ALL app instances behind the load balancer. Falls back to in-memory
// if Redis is unavailable.
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
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
      enableReadyCheck: true,
    });
    redis.connect().catch(() => {
      console.warn("⚠️ Redis connect failed — falling back to in-memory cache");
      redis = null;
    });
  }
  return redis;
}

// --- In-memory fallback (identical to original) ---
const memCache = new Map<string, { response: string; timestamp: number }>();
const MEM_TTL = 5 * 60 * 1000;
const MEM_MAX = 200;

function memPrune(): void {
  const now = Date.now();
  for (const [k, v] of memCache) {
    if (now - v.timestamp > MEM_TTL) memCache.delete(k);
  }
  while (memCache.size >= MEM_MAX) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of memCache) {
      if (v.timestamp < oldestTs) {
        oldestTs = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey === null) break;
    memCache.delete(oldestKey);
  }
}

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_MAX_ENTRIES = 200;

export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) {
    memPrune();
    const entry = memCache.get(key);
    if (entry && Date.now() - entry.timestamp < MEM_TTL) return entry.response;
    return null;
  }

  try {
    return await r.get(`chatcache:${key}`);
  } catch (err) {
    console.warn("⚠️ Redis cache get error:", err);
    const entry = memCache.get(key);
    if (entry && Date.now() - entry.timestamp < MEM_TTL) return entry.response;
    return null;
  }
}

export async function cacheSet(key: string, response: string): Promise<void> {
  const r = getRedis();
  if (!r) {
    memPrune();
    memCache.set(key, { response, timestamp: Date.now() });
    return;
  }

  try {
    const redisKey = `chatcache:${key}`;
    const pipeline = r.pipeline();
    pipeline.set(redisKey, response, "EX", CACHE_TTL_SECONDS);
    // Track keys for bounded cache — use a sorted set with timestamp as score
    pipeline.zadd("chatcache:keys", Date.now(), redisKey);
    // Trim to max entries
    pipeline.zremrangebyrank("chatcache:keys", 0, -(CACHE_MAX_ENTRIES + 1));
    await pipeline.exec();
  } catch (err) {
    console.warn("⚠️ Redis cache set error:", err);
    memCache.set(key, { response, timestamp: Date.now() });
  }
}
