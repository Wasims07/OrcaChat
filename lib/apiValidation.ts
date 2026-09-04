// =========================================
// Provider-aware API key validation.
//
// Design rules:
//  - A key is NEVER judged by its shape or prefix. The only way a key is
//    "valid" is when a real authenticated request to the target provider
//    succeeds. No code may branch on "sk-", "sk-ant", "gsk_", "hf_" etc.
//  - The target provider is chosen from the EXPLICIT base URL (highest
//    confidence) or from the model id (e.g. "anthropic/claude-sonnet-4",
//    "google/gemini-3.6-flash", "openai/gpt-4o"). When neither is given,
//    every known provider is probed so the key itself decides who it
//    belongs to — never its format.
//  - Probe requests use each provider's own auth method, headers and
//    error vocabulary, so classification is accurate per provider.
//  - This module runs ONLY on the server (Next.js route handlers). Keys
//    are never validated from the browser.
// =========================================

import { resolveBaseUrl, isAnthropicModel } from "@/lib/modelStore";

export type KeyStatus =
  | "valid"
  | "invalid"
  | "expired"
  | "revoked"
  | "permission_denied"
  | "rate_limited"
  | "unreachable"
  | "unknown";

export type VerifyResult = {
  status: KeyStatus;
  /** true when the key is usable — i.e. authenticated successfully. */
  valid: boolean;
  provider: string;
  endpoint: string;
  httpStatus?: number;
  message: string;
};

// Human-facing messages surfaced directly in the UI.
export const KEY_STATUS_MESSAGES: Record<KeyStatus, string> = {
  valid: "API key is valid.",
  invalid:
    "API key could not be authenticated. Check that the key is correct and active.",
  expired: "API key has expired. Generate a new key and try again.",
  revoked: "API key has been revoked or disabled. Generate a new key and try again.",
  permission_denied:
    "API key is valid but does not have permission to use this resource/model.",
  rate_limited:
    "API key is valid, but the account is currently rate-limited or has exceeded its quota.",
  unreachable:
    "Could not reach the provider to verify the key. Check your connection and try again.",
  unknown:
    "Could not verify this key with the provider. Check the API URL / your connection and try again.",
};

// How strongly a non-valid result proves the key was recognized.
// An "authenticated" failure (rate_limited / permission_denied / expired /
// revoked) proves the key belongs to that provider, so it ends probing.
const AUTHENTICATED_FAILURES: ReadonlySet<KeyStatus> = new Set([
  "rate_limited",
  "permission_denied",
  "expired",
  "revoked",
]);

type ProbeKind = "openai" | "anthropic" | "gemini";

type Probe = {
  provider: string;
  kind: ProbeKind;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

// ---------------------------------------------------------------
// Probe builders — one per authentication style.
// ---------------------------------------------------------------

function openAIProbe(base: string, apiKey: string, provider: string): Probe {
  return {
    provider,
    kind: "openai",
    method: "GET",
    url: openAIModelsUrl(base),
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

function anthropicProbe(apiKey: string, modelId?: string): Probe {
  // Anthropic's model ids are bare ("claude-sonnet-4"), not the
  // "anthropic/…" slugs the app routes on — strip the vendor prefix.
  const model = (modelId || "claude-3-5-haiku-latest").split("/").pop()!;
  return {
    provider: "Anthropic",
    kind: "anthropic",
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
  };
}

function geminiProbe(apiKey: string): Probe {
  // The /models list is a cheap, token-free auth check and avoids false
  // negatives when a (retired or future) model id is unknown to the API.
  return {
    provider: "Google Gemini",
    kind: "gemini",
    method: "GET",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
  };
}

function openRouterProbe(apiKey: string): Probe {
  // OpenRouter's /key endpoint is a dedicated lightweight auth check.
  return {
    provider: "OpenRouter",
    kind: "openai",
    method: "GET",
    url: "https://openrouter.ai/api/v1/key",
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

// Build a correct /models URL for an OpenAI-compatible base, wherever the
// user pasted it: bare host, versioned base (…/v1), full chat endpoint, an
// HF site URL, or an already-correct models URL.
function openAIModelsUrl(base: string): string {
  let u = base.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;

  // HF site (huggingface.co, not the router) → Inference Router endpoint.
  if (/huggingface\.co|hf\.co/i.test(u) && !/router\./i.test(u)) {
    return "https://router.huggingface.co/v1/models";
  }
  if (/\/models\/?$/i.test(u)) return u.replace(/\/+$/, "");
  if (/\/chat\/completions\/?$/i.test(u)) {
    return u.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "") + "/models";
  }
  if (/\/v\d+(\/|$)/i.test(u)) return `${u}/models`;
  return `${u}/v1/models`;
}

function labelForBase(base: string): string {
  const b = (base || "").toLowerCase();
  if (b.includes("api.mistral.ai")) return "Mistral";
  if (b.includes("api.anthropic.com")) return "Anthropic";
  if (b.includes("generativelanguage.googleapis.com") || b.includes("aistudio.google.com"))
    return "Google Gemini";
  if (b.includes("openrouter.ai")) return "OpenRouter";
  if (b.includes("api.openai.com")) return "OpenAI";
  if (b.includes("api.groq.com")) return "Groq";
  if (b.includes("api.deepseek.com")) return "DeepSeek";
  if (b.includes("api.x.ai")) return "X.AI (Grok)";
  if (b.includes("api.cohere.ai") || b.includes("api.cohere.com")) return "Cohere";
  if (b.includes("router.huggingface.co") || b.includes("huggingface.co") || b.includes("hf.co"))
    return "Hugging Face";
  if (b.includes("dashscope.aliyuncs.com")) return "Qwen (Alibaba)";
  if (b.includes("together.xyz")) return "Together AI";
  if (b.includes("deepinfra.com")) return "DeepInfra";
  if (b.includes("api.fireworks.ai")) return "Fireworks AI";
  if (b.includes("api.minimax.io")) return "MiniMax";
  if (b.includes("integrate.api.nvidia.com")) return "NVIDIA (NeMo)";
  if (b.includes("api.githubcopilot.com") || b.includes("github.com")) return "GitHub Copilot";
  if (b.includes("api.aleph-alpha.com")) return "Aleph Alpha";
  if (b.includes("localhost") || b.includes("127.0.0.1") || b.includes("ollama"))
    return "Local (Ollama)";
  return "Provider (base URL)";
}

// ---------------------------------------------------------------
// Target selection — explicit base URL first, then model id, then
// every known provider. Never the key's shape.
// ---------------------------------------------------------------

function probesForUrl(base: string, apiKey: string): Probe[] {
  const b = (base || "").trim();
  const bl = b.toLowerCase();
  if (!b) return [];
  if (bl.includes("api.anthropic.com") || bl.includes("anthropic.com")) {
    return [anthropicProbe(apiKey)];
  }
  if (
    bl.includes("generativelanguage.googleapis.com") ||
    bl.includes("aistudio.google.com") ||
    bl.includes("generativelanguage.google.com")
  ) {
    return [geminiProbe(apiKey)];
  }
  if (bl.includes("openrouter.ai")) {
    return [openRouterProbe(apiKey)];
  }
  // GitHub Copilot has no public API-key validation endpoint — it uses
  // GitHub OAuth/device-flow sessions. We cannot verify a key against it, so
  // report that honestly instead of firing a doomed probe.
  if (bl.includes("githubcopilot.com") || bl.includes("github.com")) {
    return [];
  }
  return [openAIProbe(b, apiKey, labelForBase(b))];
}

function probesForModel(modelId: string, apiKey: string): Probe[] {
  const m = (modelId || "").trim();
  if (!m) return [];
  const ml = m.toLowerCase();

  if (ml.startsWith("anthropic/") || isAnthropicModel(m)) {
    return [anthropicProbe(apiKey, m)];
  }
  if (ml.startsWith("google/") || ml.includes("gemini")) {
    return [geminiProbe(apiKey)];
  }
  if (ml.startsWith("openrouter/")) {
    return [openRouterProbe(apiKey)];
  }

  // Any other model slug resolves to a concrete provider endpoint via the
  // shared model table (OpenAI, Mistral, Groq, DeepSeek, X.AI, Cohere,
  // Hugging Face Router, Aleph Alpha, local Ollama, …).
  const base = resolveBaseUrl(m);
  if (base) {
    const bl = base.toLowerCase();
    if (bl.includes("api.anthropic.com")) return [anthropicProbe(apiKey, m)];
    if (bl.includes("generativelanguage.googleapis.com") || bl.includes("aistudio.google.com"))
      return [geminiProbe(apiKey)];
    if (bl.includes("openrouter.ai")) return [openRouterProbe(apiKey)];
    return [openAIProbe(base, apiKey, labelForBase(base))];
  }

  // No mapping — bounce through the OpenRouter gateway (accepts many keys).
  return [openRouterProbe(apiKey)];
}

// With neither a base URL nor a model id we probe every known provider. The
// first provider that authenticates the key wins; there is NO key-prefix
// guessing.
function probesForUnknownKey(apiKey: string): Probe[] {
  return [
    { provider: "OpenAI", kind: "openai" as const, method: "GET" as const, url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    openRouterProbe(apiKey),
    { provider: "Mistral", kind: "openai" as const, method: "GET" as const, url: "https://api.mistral.ai/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "DeepSeek", kind: "openai" as const, method: "GET" as const, url: "https://api.deepseek.com/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "Groq", kind: "openai" as const, method: "GET" as const, url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "Hugging Face", kind: "openai" as const, method: "GET" as const, url: "https://router.huggingface.co/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "X.AI (Grok)", kind: "openai" as const, method: "GET" as const, url: "https://api.x.ai/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "Fireworks AI", kind: "openai" as const, method: "GET" as const, url: "https://api.fireworks.ai/inference/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "MiniMax", kind: "openai" as const, method: "GET" as const, url: "https://api.minimax.io/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "NVIDIA (NeMo)", kind: "openai" as const, method: "GET" as const, url: "https://integrate.api.nvidia.com/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "Together AI", kind: "openai" as const, method: "GET" as const, url: "https://api.together.xyz/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "Cohere", kind: "openai" as const, method: "GET" as const, url: "https://api.cohere.ai/compatibility/v1/models", headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "GitHub Copilot", kind: "openai" as const, method: "GET" as const, url: "https://api.githubcopilot.com/models", headers: { Authorization: `Bearer ${apiKey}` } },
    geminiProbe(apiKey),
    anthropicProbe(apiKey),
  ];
}

// ---------------------------------------------------------------
// Error classification — provider-aware, reads the actual provider
// response (status + body) instead of guessing from the key.
// ---------------------------------------------------------------

function classify(status: number, body: string, kind: ProbeKind): KeyStatus {
  // Success: the request authenticated.
  if (status >= 200 && status < 300) return "valid";

  const text = (body || "").slice(0, 2000);
  const low = text.toLowerCase();

  // A redirected success (3xx → landing page) is NOT an API response.
  const contentTypeIsHtml =
    status >= 200 &&
    status < 300 &&
    /<html|<!doctype|text\/html/i.test(text);
  if (contentTypeIsHtml) return "unreachable";

  // Quota / rate limiting first — it proves the key authenticated.
  if (status === 402) return "rate_limited"; // payment required / out of quota
  if (status === 429) return "rate_limited";

  const saysRateLimited = /rate limit|too many request|quota|concurren|throttl|temporarily overloaded/i.test(low);
  const saysExpired = /expir|no longer active|key.*deactiv|invalid.*date/i.test(low);
  const saysRevoked = /revok|deactiv|disabled|removed|deleted|suspended/i.test(low);
  const saysPermission = /permission|forbidden|not (allow|permit)ed|access denied|does not have access|not authorized|denied/i.test(low);
  const saysInvalid = /invalid api key|incorrect api key|api key not valid|api key.*invalid|unauthorized|authentication|bad credentials|no auth|credential|invalid.*token|invalid_token|api key limited to/i.test(low);

  if (saysRateLimited) return "rate_limited";
  if (saysExpired) return "expired";
  if (saysRevoked) return "revoked";
  if (saysPermission) return "permission_denied";
  if (saysInvalid) return "invalid";

  if (status === 401) return "invalid";
  if (status === 403) return "permission_denied";
  if (status === 404) return "unknown"; // endpoint not found — cannot judge the key
  if (status === 400) {
    // Gemini reports invalid keys as 400 with no strong keyword — treat it
    // as invalid there; elsewhere a 400 is usually a malformed request.
    return kind === "gemini" ? "invalid" : "unknown";
  }
  if (status >= 500) return "unreachable";
  return "unknown";
}

// ---------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------

export async function verifyApiKey(opts: {
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}): Promise<VerifyResult> {
  const apiKey = (opts.apiKey || "").replace(/[\s\u0000-\u001F]/g, "").trim();
  const baseUrl = (opts.baseUrl || "").trim();
  const modelId = (opts.modelId || "").trim();

  let probes: Probe[] = [];
  if (baseUrl) probes = probesForUrl(baseUrl, apiKey);
  else if (modelId) probes = probesForModel(modelId, apiKey);
  else probes = probesForUnknownKey(apiKey);

  // Never let any single probe hang the whole verification.
  const deadline = Date.now() + 45000;

  // Track every outcome so we can pick the strongest signal.
  const seen: Array<{ provider: string; status: KeyStatus; httpStatus?: number; endpoint: string }> = [];

  for (const probe of probes) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) break;

    let res: Response | null = null;
    try {
      res = await fetch(probe.url, {
        method: probe.method,
        headers: probe.headers,
        ...(probe.body ? { body: probe.body } : {}),
        signal: AbortSignal.timeout(Math.min(remaining, 10000)),
      });
    } catch {
      seen.push({ provider: probe.provider, status: "unreachable", endpoint: probe.url });
      continue;
    }

    const bodyText = await res.text().catch(() => "");
    const status = classify(res.status, bodyText, probe.kind);

    if (status === "valid") {
      return {
        status: "valid",
        valid: true,
        provider: probe.provider,
        endpoint: probe.url,
        httpStatus: res.status,
        message: KEY_STATUS_MESSAGES.valid,
      };
    }

    seen.push({
      provider: probe.provider,
      status,
      httpStatus: res.status,
      endpoint: probe.url,
    });

    // The provider authenticated the key but reported a quota/permission or
    // lifecycle problem. That's the key's true state — stop probing.
    if (AUTHENTICATED_FAILURES.has(status)) break;
  }

  // Aggregate: pick the strongest signal from what we saw.
  const rank: Record<KeyStatus, number> = {
    valid: 10,
    rate_limited: 9,
    permission_denied: 8,
    expired: 6,
    revoked: 5,
    invalid: 4,
    unreachable: 2,
    unknown: 1,
  };

  const best = seen.reduce<typeof seen[number] | null>((acc, item) => {
    if (!acc) return item;
    return rank[item.status] > rank[acc.status] ? item : acc;
  }, null);

  const status: KeyStatus = best?.status || "unknown";
  // A rate-limited key still authenticated, so it's usable once the limit
  // resets — treat it as valid (with a warning) rather than rejecting it.
  const valid = status === "valid" || status === "rate_limited";

  return {
    status,
    valid,
    provider: best?.provider || "Unknown",
    endpoint: best?.endpoint || "",
    httpStatus: best?.httpStatus,
    message: KEY_STATUS_MESSAGES[status],
  };
}