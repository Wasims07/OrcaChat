// localStorage store for custom AI models (name + API key)
// added by the user in the Models manager.

import { encryptString, decryptString } from "@/lib/chatCrypto";

export type CustomModel = {
  id: string;
  name: string;
  modelId: string;
  apiKey: string;
  // Optional provider API base URL. When empty, the server derives an
  // endpoint from the model slug (OpenRouter, Anthropic, deepseek, etc.).
  // Examples: https://api.deepseek.com, https://openrouter.ai/api/v1,
  //           https://api.anthropic.com, https://api.openai.com/v1
  baseUrl?: string;
  createdAt: number;
};

const STORAGE_KEY = "orcachat_custom_models";
const SELECTED_KEY = "orcachat_selected_model";

// In-memory decrypted cache — the source of truth for reads within a tab.
// The encrypted blob in localStorage is only decrypted once (on first load),
// so callers get synchronous reads after hydration.
let modelCache: CustomModel[] | null = null;

// Decrypt + parse the stored model list. Handles both the new encrypted format
// and legacy plaintext (written before encryption was added).
async function loadModels(): Promise<CustomModel[]> {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const decrypted = await decryptString(raw);
    const arr = JSON.parse(decrypted || "[]");
    return Array.isArray(arr) ? (arr as CustomModel[]) : [];
  } catch {
    return [];
  }
}

async function persistModels(): Promise<void> {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(modelCache ?? []);
  const encrypted = (await encryptString(serialized)) ?? serialized;
  try {
    localStorage.setItem(STORAGE_KEY, encrypted);
  } catch {
    // ignore quota / availability errors
  }
}

async function ensureLoaded(): Promise<void> {
  if (modelCache !== null || typeof window === "undefined") return;
  modelCache = await loadModels();
}

// On writes from OTHER tabs, drop the in-memory cache so the next read
// re-decrypts the fresh value from localStorage.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === SELECTED_KEY) {
      modelCache = null;
    }
  });
}

export async function getCustomModels(): Promise<CustomModel[]> {
  await ensureLoaded();
  return modelCache ?? [];
}

export async function saveCustomModel(model: CustomModel): Promise<CustomModel[]> {
  await ensureLoaded();
  modelCache = [
    ...(modelCache ?? []).filter((m) => m.id !== model.id),
    model,
  ];
  await persistModels();
  return modelCache;
}

export async function removeCustomModel(id: string): Promise<CustomModel[]> {
  await ensureLoaded();
  modelCache = (modelCache ?? []).filter((m) => m.id !== id);
  await persistModels();
  return modelCache;
}

export const getStoredSelectedModel = async (): Promise<string | null> => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return null;
    // Selected model is a short string; store it encrypted for consistency.
    const decrypted = await decryptString(raw);
    return decrypted ?? null;
  } catch {
    return null;
  }
};

export const storeSelectedModel = async (modelId: string) => {
  if (typeof window === "undefined" || !modelId) return;
  const encrypted = (await encryptString(modelId)) ?? modelId;
  try {
    localStorage.setItem(SELECTED_KEY, encrypted);
  } catch {}
};

// Map a human-friendly model name to an OpenRouter model slug.
// Users only type a name + API key; the slug is resolved automatically.
const MODEL_ALIASES: Array<[RegExp, string]> = [
  [/deepseek/, "deepseek/deepseek-chat"],
  [/gpt-5\.2/, "openai/gpt-5.2"],
  [/gpt-5/, "openai/gpt-5"],
  [/gpt-4o/, "openai/gpt-4o"],
  [/gpt-4/, "openai/gpt-4o"],
  [/chatgpt/, "openai/gpt-4o"],
  [/claude.*opus/, "anthropic/claude-opus-4"],
  [/claude.*sonnet/, "anthropic/claude-sonnet-4"],
  [/claude.*haiku/, "anthropic/claude-haiku-4"],
  [/claude/, "anthropic/claude-sonnet-4"],
  [/gemini.*flash/i, "google/gemini-3.6-flash"],
  [/gemini.*pro/i, "google/gemini-3.6-pro"],
  [/gemini/i, "google/gemini-3.6-flash"],
  [/gemma/, "google/gemma-3-27b-it"],
  [/llama/, "meta-llama/llama-3.3-70b-instruct"],
  [/mistral.*large/i, "mistralai/mistral-large-2512"],
  [/mistral.*small/i, "mistralai/mistral-small-2603"],
  [/mistral/i, "mistralai/mistral-small-2603"],
  [/mixtral/, "mistralai/mixtral-8x7b-instruct"],
  [/codestral/, "mistralai/codestral-2501"],
  [/olmo/i, "openeurollm/OLMo-1.7B-Instruct-v0.1"],
  [/eurollm|euro-llm/i, "utter-project/EuroLLM-1.7B-Instruct"],
  [/openeurollm/i, "openeurollm/OLMo-1.7B-Instruct-v0.1"],
  [/luminous/i, "luminous-supreme"],
  [/aleph[ -]?alpha/i, "luminous-supreme"],
  [/grok/i, "x-ai/grok-2-1212"],
  [/qwen/, "qwen/qwen-2.5-72b-instruct"],
  [/glm/, "z-ai/glm-4.5"],
  [/minimax/, "minimax/minimax-m2"],
  [/nemotron/, "nvidia/nemotron-3-super-120b-a12b"],
  [/command[- ]?r/, "cohere/command-r-plus"],
  [/dall[ -]?e/, "openai/dall-e-3"],
  [/fireworks/, "fireworks/accounts/fireworks/models/firefunction-v2"],
  [/falcon/, "tiiuae/falcon3-7b-instruct"],
  [/soofi/, "Soofi-Project/Soofi-S-Instruct-Preview"],
  [/copilet|copilot/, "github/copilot"],
];

export function resolveModelSlug(name: string): string {
  const trimmed = name.trim();
  const n = trimmed.toLowerCase();
  if (!n) return trimmed;
  // If the name already looks like a provider/model slug, use it as-is.
  if (n.includes("/")) return trimmed;
  for (const [re, slug] of MODEL_ALIASES) {
    if (re.test(n)) return slug;
  }
  return n.replace(/\s+/g, "-");
}

// Suggest a default base URL for a resolved model slug.  Returns "" for
// most models — the user only needs to set a baseUrl when they want to
// bypass OpenRouter and hit a provider directly (e.g. their own Gemini
// API key against Google's endpoint).
export function resolveBaseUrl(modelId: string): string {
  const id = modelId.toLowerCase();
  const starts = (prefix: string) => id.startsWith(prefix);
  // Suggest the provider's native endpoint. The user will paste their own
  // native key for that provider (e.g. a Mistral key for Mistral, a Google
  // key for Gemini). When they leave it empty, it falls back to OpenRouter.
  if (starts("anthropic/")) return "https://api.anthropic.com";
  if (starts("deepseek/")) return "https://api.deepseek.com";
  if (starts("openai/") || starts("o1") || id.startsWith("gpt-"))
    return "https://api.openai.com/v1";
  if (starts("google/") || id.startsWith("gemini"))
    return "https://generativelanguage.googleapis.com/v1beta/openai";
  if (starts("meta-llama/")) return "https://api.groq.com/openai/v1";
  if (starts("mistralai/") || id.startsWith("mixtral") || id.includes("codestral"))
    return "https://api.mistral.ai/v1";
  if (starts("x-ai/") || id.includes("grok")) return "https://api.x.ai/v1";
  if (starts("qwen/") || id.includes("qwen")) return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  if (starts("cohere/") || id.includes("cohere")) return "https://api.cohere.ai/compatibility/v1";
  if (starts("minimax/") || id.includes("minimax")) return "https://api.minimax.io/v1";
  if (starts("together/") || id.includes("together")) return "https://api.together.xyz/v1";
  if (starts("deepinfra/") || id.includes("deepinfra")) return "https://api.deepinfra.com/v1/openai";
  if (starts("fireworks/") || id.includes("fireworks")) return "https://api.fireworks.ai/inference/v1";
  if (starts("luminous") || id.includes("aleph"))
    return "https://api.aleph-alpha.com";
  // Open-weight EU / AI2 models (OLMo, EuroLLM, OpenEuroLLM) and the German
  // SOOFI models (Soofi-Project/Soofi-S-*) have no first-party chat API —
  // serve them through the Hugging Face Inference Router so they work the
  // moment they are deployed (and via self-hosted vLLM/Ollama otherwise).
  if (
    id.includes("openeurollm") ||
    id.includes("eurollm") ||
    id.includes("olmo") ||
    id.includes("soofi") ||
    id.includes("falcon") ||
    id.includes("gemma") ||
    id.includes("llama")
  )
    return "https://router.huggingface.co/v1";
  return "";
}

// True when the model id targets a provider that speaks Anthropic's Messages
// API rather than the OpenAI-compatible chat completions API.
export function isAnthropicModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("anthropic/");
}

// Detect the provider + a working default endpoint and model id from an API
// key prefix alone (used when the user doesn't provide a base URL).
export function resolveFromKey(
  key: string
): { provider: string; modelId: string; baseUrl: string } {
  const kLow = (key || "").trim().toLowerCase();
  if (!kLow)
    return { provider: "Unknown", modelId: "", baseUrl: "" };

  if (/^ai[a-z0-9]+$/i.test(kLow) || kLow.startsWith("aq"))
    return { provider: "Google (Gemini)", modelId: "gemini-3.6-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" };
  if (kLow.startsWith("sk-ant"))
    return { provider: "Anthropic (Claude)", modelId: "claude-sonnet-4", baseUrl: "https://api.anthropic.com" };
  if (kLow.startsWith("sk-or-v1") || kLow.startsWith("sk-or-"))
    return { provider: "OpenRouter", modelId: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1" };
  if (kLow.startsWith("gsk_"))
    return { provider: "Groq", modelId: "llama-3.3-70b-versatile", baseUrl: "https://api.groq.com/openai/v1" };
  if (kLow.startsWith("hf_"))
    return { provider: "Hugging Face", modelId: "meta-llama/Llama-3.1-8B-Instruct", baseUrl: "https://router.huggingface.co/v1" };
  if (kLow.startsWith("sk-"))
    return { provider: "OpenAI", modelId: "gpt-4o", baseUrl: "https://api.openai.com/v1" };
  return { provider: "Unknown", modelId: "", baseUrl: "" };
}

// Detect provider/model/endpoint from the user-friendly model name alone.
// Used as a final fallback when neither the API URL nor the key prefix
// identified a provider (e.g. typing "Mistral", "EuroLLM", "OLMo").
export function resolveFromName(
  name: string
): { provider: string; modelId: string; baseUrl: string } {
  const slug = resolveModelSlug(name.trim());
  if (!slug) return { provider: "Unknown", modelId: "", baseUrl: "" };
  const baseUrl = resolveBaseUrl(slug);
  // baseUrl is empty → we don't have a mapped endpoint for this model,
  // so we cannot guarantee it works; treat it as unresolvable.
  if (!baseUrl) return { provider: "Unknown", modelId: "", baseUrl: "" };

  let provider = "OpenAI-compatible";
  if (baseUrl.includes("api.mistral.ai")) provider = "Mistral";
  else if (baseUrl.includes("api.aleph-alpha.com")) provider = "Aleph Alpha";
  else if (baseUrl.includes("router.huggingface.co")) provider = "Hugging Face";
  else if (baseUrl.includes("api.fireworks.ai")) provider = "Fireworks AI";
  else if (baseUrl.includes("api.cohere.ai")) provider = "Cohere";
  else if (baseUrl.includes("api.minimax.io")) provider = "MiniMax";
  else if (baseUrl.includes("api.together.xyz")) provider = "Together AI";
  return { provider, modelId: slug, baseUrl };
}

// Given a provider base URL, detect which provider it is, pick a sensible
// default model id, and normalize the URL to the provider's real API base.
// The user only ever supplies a friendly name + URL + key; we derive the
// actual model id and endpoint so a real request can be made.
// Console/dashboard URLs (e.g. console.mistral.ai, platform.deepseek.com)
// are recognized and rewritten to the API base, because users commonly copy
// those instead of the actual API URL.
export function resolveModelFromUrl(
  baseUrl: string
): { provider: string; modelId: string; baseUrl: string } {
  let raw = (baseUrl || "").trim();
  if (!raw) return { provider: "Unknown", modelId: "", baseUrl: "" };
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const b = raw.toLowerCase();

  type Rule = {
    match: RegExp;
    provider: string;
    modelId: string;
    // Canonical API base the saved model should actually call. Empty keeps
    // the user's own URL (local/special endpoints).
    apiBase: string;
  };

  const rules: Rule[] = [
    { match: /mistral\.ai/, provider: "Mistral", modelId: "mistral-small-latest", apiBase: "https://api.mistral.ai/v1" },
    { match: /anthropic\.com/, provider: "Anthropic (Claude)", modelId: "claude-sonnet-4", apiBase: "https://api.anthropic.com" },
    { match: /generativelanguage\.(googleapis\.com|google\.com)|aistudio\.google\.com/, provider: "Google (Gemini)", modelId: "gemini-3.6-flash", apiBase: "https://generativelanguage.googleapis.com" },
    { match: /openrouter\.ai/, provider: "OpenRouter", modelId: "openrouter/free", apiBase: "https://openrouter.ai/api/v1" },
    { match: /openai\.com/, provider: "OpenAI", modelId: "gpt-4o", apiBase: "https://api.openai.com/v1" },
    { match: /groq\.com/, provider: "Groq", modelId: "llama-3.3-70b-versatile", apiBase: "https://api.groq.com/openai/v1" },
    { match: /deepseek\.com/, provider: "DeepSeek", modelId: "deepseek-chat", apiBase: "https://api.deepseek.com" },
    { match: /huggingface\.co|hf\.co/, provider: "Hugging Face", modelId: "meta-llama/Llama-3.1-8B-Instruct", apiBase: "https://router.huggingface.co/v1" },
    { match: /x\.ai/, provider: "X.AI (Grok)", modelId: "grok-2-1212", apiBase: "https://api.x.ai/v1" },
    { match: /cohere\.com/, provider: "Cohere", modelId: "command-r-plus", apiBase: "https://api.cohere.ai/compatibility/v1" },
    { match: /dashscope\.aliyuncs\.com/, provider: "Qwen (Alibaba)", modelId: "qwen-plus", apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { match: /together\.xyz/, provider: "Together AI", modelId: "meta-llama/llama-3.3-70b-instruct-turbo", apiBase: "https://api.together.xyz/v1" },
    { match: /deepinfra\.com/, provider: "DeepInfra", modelId: "meta-llama/llama-3.1-70b-instruct", apiBase: "https://api.deepinfra.com/v1/openai" },
    { match: /fireworks\.ai/, provider: "Fireworks AI", modelId: "accounts/fireworks/models/firefunction-v2", apiBase: "https://api.fireworks.ai/inference/v1" },
    { match: /minimax\.io|minimaxi\.com/, provider: "MiniMax", modelId: "MiniMax-M3", apiBase: "https://api.minimax.io/v1" },
    { match: /nvidia\.com/, provider: "NVIDIA (NeMo)", modelId: "nvidia/nemotron-3-super-120b-a12b", apiBase: "https://integrate.api.nvidia.com/v1" },
    { match: /soofi/, provider: "Soofi (open-weight)", modelId: "soofiproject/soofi-s-instruct", apiBase: "https://router.huggingface.co/v1" },
    { match: /githubcopilot\.com/, provider: "GitHub Copilot", modelId: "gpt-4o", apiBase: "https://api.githubcopilot.com" },
    { match: /aleph[- ]?alpha\.com|alephalpha/, provider: "Aleph Alpha", modelId: "luminous-supreme", apiBase: "https://api.aleph-alpha.com" },
    { match: /deepl\.com/, provider: "DeepL (translation)", modelId: "deepl-translate", apiBase: "https://api.deepl.com" },
    { match: /(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|ollama)/, provider: "Local (Ollama)", modelId: "llama3", apiBase: "" },
  ];

  for (const rule of rules) {
    if (rule.match.test(b)) {
      return {
        provider: rule.provider,
        modelId: rule.modelId,
        // Use the canonical API base (rewrites console URLs to the API), but
        // keep the user's exact URL for local / non-standard endpoints.
        baseUrl: rule.apiBase || raw,
      };
    }
  }

  // No known provider — treat it as a generic OpenAI-compatible endpoint.
  return { provider: "OpenAI-compatible", modelId: "", baseUrl: raw };
}

// Map a resolved model slug to a human-readable provider name.
export function describeProvider(modelId: string): string {
  const id = (modelId || "").toLowerCase();
  if (id.startsWith("anthropic/")) return "Anthropic (Claude)";
  if (id.startsWith("deepseek/")) return "DeepSeek";
  if (id.startsWith("google/") || id.includes("gemini")) return "Google (Gemini)";
  if (id.startsWith("openai/") || id.startsWith("gpt-")) return "OpenAI";
  if (id.startsWith("mistralai/") || id.includes("mistral")) return "Mistral";
  if (id.startsWith("meta-llama/") || id.includes("llama")) return "Meta (Llama)";
  if (id.startsWith("x-ai/") || id.includes("grok")) return "X.AI (Grok)";
  if (id.startsWith("qwen/")) return "Qwen (Alibaba)";
  if (id.startsWith("cohere/")) return "Cohere";
  if (id.startsWith("z-ai/") || id.includes("glm")) return "Z.AI (GLM)";
  if (id.startsWith("nvidia/") || id.includes("nemotron")) return "NVIDIA";
  if (id.startsWith("minimax/")) return "MiniMax";
  if (id.startsWith("together/") || id.includes("together")) return "Together AI";
  if (id.startsWith("deepinfra/") || id.includes("deepinfra")) return "DeepInfra";
  if (id.startsWith("fireworks/") || id.includes("fireworks")) return "Fireworks AI";
  if (id.includes("soofi") || id.includes("falcon")) return "Hugging Face (open-weight)";
  if (id.includes("copilet") || id.includes("copilot")) return "GitHub Copilot";
  if (id.startsWith("luminous") || id.includes("aleph")) return "Aleph Alpha";
  if (id.includes("openeurollm") || id.includes("eurollm") || id.includes("olmo"))
    return "Hugging Face (open-weight)";
  if (id.includes("localhost") || id.includes("127.0.0.1") || id.includes("ollama"))
    return "Local (Ollama)";
  return "OpenRouter (auto-routed)";
}

// True when the selected model runs fully on the user's own machine (e.g.
// Ollama on localhost). In that case no conversation data ever leaves the
// device — used for the "data leaves device" privacy indicator.
export function isLocalModel(modelId: string, baseUrl?: string): boolean {
  const b = (baseUrl || "").toLowerCase();
  if (
    b.includes("localhost") ||
    b.includes("127.0.0.1") ||
    b.includes("0.0.0.0") ||
    b.includes("::1") ||
    b.includes("ollama")
  ) {
    return true;
  }
  const id = (modelId || "").toLowerCase();
  return (
    id.includes("ollama") ||
    id.includes("localhost") ||
    /^ctx[:\/]/.test(id) ||
    /^\.\.\//.test(id)
  );
}