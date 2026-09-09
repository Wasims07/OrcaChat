// =========================================
// Shared server-side security helpers.
//
// Used by every API route handler. Everything here runs ONLY on the server.
// =========================================

import type { NextRequest } from "next/server";

// Hard cap on request payloads. Keeps a single request from exhausting server
// memory. Set to 100 MB (as base64 this caps ~75 MB of raw file data) — plenty
// for document uploads, while bounding memory use on each request.
export const MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------
// Client IP — best-effort, never trusted for decisions that need
// hard guarantees (it can be spoofed behind a plain reverse proxy).
// Good enough as a first-line abuse throttle.
// ---------------------------------------------------------------
export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return req.headers.get("x-vercel-ip") || "local";
}

// ---------------------------------------------------------------
// Anonymous client token — the privacy-first replacement for the IP
// used to key abuse throttles. The browser generates a random,
// unlinkable id on first use and sends it with each request. It is
// intentionally NOT the user's IP, carries no identity, and cannot be
// correlated back to a person. This keeps per-client abuse protection
// for shared resources (e.g. the free-tier OpenRouter key) without
// tracking anyone.
// ---------------------------------------------------------------
export function getClientToken(req: NextRequest): string {
  return req.headers.get("x-client-token") || "anonymous";
}

// ---------------------------------------------------------------
// Sliding-window rate limiter (in-memory, per process instance).
// Used to blunt API abuse / DDoS. NOT a substitute for a real
// distributed limiter behind a load balancer.
// ---------------------------------------------------------------
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  check(ip: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    this.sweepIfLarge();

    const arr = (this.hits.get(ip) || []).filter((t) => now - t < this.windowMs);

    if (arr.length >= this.maxRequests) {
      this.hits.set(ip, arr);
      const oldest = arr[0];
      return { allowed: false, retryAfterMs: Math.max(1, this.windowMs - (now - oldest)) };
    }

    arr.push(now);
    this.hits.set(ip, arr);
    return { allowed: true, retryAfterMs: 0 };
  }

  // Keep memory bounded even under a flood of unique addresses.
  private sweepIfLarge(): void {
    if (this.hits.size < 10000) return;
    const now = Date.now();
    for (const [ip, arr] of this.hits) {
      const live = arr.filter((t) => now - t < this.windowMs);
      if (live.length === 0) this.hits.delete(ip);
      else this.hits.set(ip, live);
    }
  }
}

// ---------------------------------------------------------------
// Error-message sanitizer.
//
// Provider error bodies sometimes echo the Authorization header or other
// key material. Before ANY error text is logged or returned to the client it
// is scrubbed of credential-shaped strings and control characters.
// ---------------------------------------------------------------
const KEY_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_\-]{16,}\b/g, "(an API key)"],
  [/\bsk-ant[A-Za-z0-9_\-]*/g, "(an API key)"],
  [/\bsk-or-v1[A-Za-z0-9_\-]*/g, "(an API key)"],
  [/\bgsk_[A-Za-z0-9_\-]{6,}/g, "(an API key)"],
  [/\bhf_[A-Za-z0-9_\-]{6,}/g, "(an API key)"],
  [/\bAIza[0-9A-Za-z_\-]{20,}\b/g, "(an API key)"],
  [/bearer\s+[A-Za-z0-9._\-]{12,}/gi, "Bearer (redacted)"],
  [/\bx-api-key["']?\s*[:=]\s*["']?[A-Za-z0-9._\-]{12,}/gi, "x-api-key: (redacted)"],
];

export function sanitizeErrorMessage(text: string, maxLen = 300): string {
  if (!text) return "";
  let out = text;
  for (const [pattern, replacement] of KEY_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  // Strip HTML tag-like sequences so a hostile/snarky provider error message
  // can never carry markup into a DOM or log-forgery context. "a < b" (with
  // whitespace after <) is preserved.
  out = out.replace(/<[^>\s][^>]*>/g, " ").replace(/\s+/g, " ").trim();
  out = out.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return out.length > maxLen ? out.slice(0, maxLen) + "…" : out;
}

// ---------------------------------------------------------------
// HTML sanitizer for user-supplied documents (docx/xlsx previews).
//
// The app renders these with dangerouslySetInnerHTML, so the HTML must be
// scrubbed of executable content before it is returned to the browser:
//   - whole dangerous elements (script, iframe, object, embed, form, meta,
//     link, style, svg, math, noscript, template, input, button, select)
//   - event-handler attributes (onclick, onload, ...)
//   - javascript:/vbscript:/data:text/html URIs in any attribute
//   - srcdoc and formtarget (UI redressing / navigation tricks)
//
// This is defense-in-depth. The canonical fix is to stop rendering document
// HTML at all, but while previews exist this is the layer that makes the
// dangerouslySetInnerHTML sink safe for documents.
// ---------------------------------------------------------------
// Decode HTML entities (numeric + a few common named ones) so that
// scheme-checks see the REAL value, not an encoded disguise (e.g.
// `jav&#x61;script:`).
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/")
    .replace(/&tab;/gi, "\t")
    .replace(/&colon/g, ":")
    .replace(/&amp;/gi, "&");
}

export function sanitizeUploadedHtml(html: string): string {
  if (!html) return "";
  let out = html;

  // Remove complete element blocks for the dangerous tags (with content).
  // Loop until stable so nested/malformed variants (<script><script>…)
  // cannot survive the innermost pair and leave a live outer one.
  const DANGEROUS_TAGS =
    "script|iframe|object|embed|form|input|button|select|option|textarea|link|meta|style|svg|math|noscript|template|base";
  const blockRe = new RegExp(
    `<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "gi"
  );
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(blockRe, "");
  }
  // Remove lone opening/closing tags that were left behind (malformed HTML).
  out = out.replace(new RegExp(`<(?:${DANGEROUS_TAGS})\\b[^>]*\\/?>`, "gi"), "");
  out = out.replace(new RegExp(`<\\/(?:${DANGEROUS_TAGS})\\s*>`, "gi"), "");

  // Strip event-handler attributes on any element.
  out = out.replace(
    /\s+on[a-zA-Z][a-zA-Z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+)/gi,
    ""
  );

  // Strip style attributes entirely — CSS can smuggle url(javascript:…),
  // behavior:url(…), -moz-binding, and other executable payloads.
  out = out.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+)/gi, "");

  // Strip srcdoc / formtarget + any explicit "formaction".
  out = out.replace(/\s+(?:srcdoc|formtarget|formaction|data-html)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+)/gi, "");

  // Remove an href/src/action attribute whose (entity-decoded) value is a
  // script/data URI. Checking the decoded value defeats encoded schemes.
  out = out.replace(
    /\s+(?:href|src|action|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+)/gi,
    (_match, rawVal) => {
      const val = decodeEntities(String(rawVal).replace(/^["']|["']$/g, "")).trim().toLowerCase();
      if (/^(?:javascript|vbscript|data|file|blob)\s*:/.test(val)) return "";
      return _match;
    }
  );

  // Belt-and-braces: neutralize the raw scheme token anywhere it appears.
  out = out.replace(/\b(?:javascript|vbscript|data:text\/html|data:text\/javascript)\s*:/gi, "blocked:");

  return out;
}