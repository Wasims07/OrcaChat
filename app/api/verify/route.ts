import { NextRequest } from "next/server";
import { verifyApiKey } from "@/lib/apiValidation";
import {
  MAX_REQUEST_BODY_BYTES,
  getClientToken,
} from "@/lib/security";
import { RedisSlidingWindowRateLimiter } from "@/lib/redisRateLimiter";

// Verification probes hit real provider endpoints — throttle it so it can't
// be used to grind third-party APIs.
const limiter = new RedisSlidingWindowRateLimiter(30, 60_000, "verify");

// POST /api/verify
// Securely validates a user-supplied API key on the server by making a real
// authenticated request to the target provider. The key string is never
// judged by its format — only a success (or an authenticated failure) from
// the provider itself counts. Returns a normalized status the UI maps to a
// clear message. The raw key never leaves the server for validation; nothing
// key-shaped is logged or returned here.
export async function POST(req: NextRequest) {
  try {
    const throttle = await limiter.check(getClientToken(req));
    if (!throttle.allowed) {
      return new Response(
        JSON.stringify({
          valid: false,
          status: "rate_limited",
          message: "Too many verification requests. Please wait a moment and try again.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(throttle.retryAfterMs / 1000)),
          },
        }
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_REQUEST_BODY_BYTES) {
      return new Response(
        JSON.stringify({ valid: false, status: "unknown", message: "Request body is too large." }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }
    let body: { apiKey?: unknown; baseUrl?: unknown; modelId?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ valid: false, status: "unknown", message: "Invalid JSON in request body." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          valid: false,
          status: "unknown",
          provider: "Unknown",
          message: "API key is required.",
          error: "API key is required.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await verifyApiKey({
      apiKey,
      baseUrl: typeof body?.baseUrl === "string" ? body.baseUrl : undefined,
      modelId: typeof body?.modelId === "string" ? body.modelId : undefined,
    });

    return new Response(
      JSON.stringify({
        valid: result.valid,
        status: result.status,
        provider: result.provider,
        endpoint: result.endpoint,
        httpStatus: result.httpStatus,
        message: result.message,
        ...(result.valid ? {} : { error: result.message }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        valid: false,
        status: "unknown",
        provider: "Unknown",
        message:
          "Could not verify this key with the provider. Check the API URL / your connection and try again.",
        error: error instanceof Error ? error.message : "Validation failed on the server.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}