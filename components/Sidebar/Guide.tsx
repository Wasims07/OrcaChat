"use client";

import { useState } from "react";
import {
  X,
  KeyRound,
  Cpu,
  Terminal,
  Check,
  ShieldCheck,
  Database,
  ExternalLink,
  Copy,
} from "lucide-react";
import { getTheme } from "@/lib/profile";
import { useCallback } from "react";

type GuideProps = {
  onClose: () => void;
};

const TABS = [
  { id: "keys", label: "Setup", icon: <KeyRound size={15} /> },
  { id: "models", label: "Supported models", icon: <Cpu size={15} /> },
  { id: "reset", label: "Reset data", icon: <Database size={15} /> },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Provider = {
  name: string;
  brand: string;
  keyFormat: string;
  url: string;
  urlLabel: string;
  note: string;
  recommended: boolean;
  local: boolean;
  steps: string[];
};

// Ordered: recommended / local options first.
const PROVIDER_GUIDES: Provider[] = [
  {
    name: "Ollama",
    brand: "Ollama",
    keyFormat: "No API key",
    url: "https://ollama.com/download",
    urlLabel: "ollama.com",
    note: "Runs 100% locally — your data never leaves your machine.",
    recommended: true,
    local: true,
    steps: [
      "Download and install Ollama from ollama.com/download.",
      "Open a terminal and pull a model, e.g. `ollama pull llama3.2` (or qwen2.5, mistral, etc.).",
      "Keep the Ollama app running so it listens on http://localhost:11434.",
      "In OrcaChat: Models → Add → API URL http://localhost:11434, then pick any model you pulled.",
    ],
  },
  {
    name: "LM Studio",
    brand: "LM Studio",
    keyFormat: "No API key",
    url: "https://lmstudio.ai",
    urlLabel: "lmstudio.ai",
    note: "Free desktop app for running GGUF models locally.",
    recommended: true,
    local: true,
    steps: [
      "Download LM Studio from lmstudio.ai and install it.",
      "Search and download a model from the built-in catalog (e.g. Llama 3, Mistral, Qwen).",
      "Load the model, then go to Developer → Local Server and click Start Server (default http://localhost:1234/v1).",
      "In OrcaChat: Models → Add → API URL http://localhost:1234/v1, then pick the loaded model.",
    ],
  },
  {
    name: "Mistral",
    brand: "Mistral AI",
    keyFormat: "long random string",
    url: "https://console.mistral.ai/api-keys/",
    urlLabel: "console.mistral.ai/api-keys",
    note: "Strong models with a free tier.",
    recommended: false,
    local: false,
    steps: [
      "Sign up at console.mistral.ai.",
      "Go to API Keys → Create new key.",
      "Copy the key and paste it into OrcaChat.",
      "Models: Mistral Small / Large, Codestral, Ministral.",
    ],
  },
  {
    name: "OpenRouter",
    brand: "OpenRouter",
    keyFormat: "sk-or-v1-…",
    url: "https://openrouter.ai/keys",
    urlLabel: "openrouter.ai/keys",
    note: "One key for hundreds of models from many labs.",
    recommended: false,
    local: false,
    steps: [
      "Create a free account at openrouter.ai (sign in with Google/GitHub).",
      "Open Settings → Keys → Create Key.",
      "Copy the key (starts with sk-or-v1-) and paste it into OrcaChat.",
      "Use any model, including free ones suffixed with :free.",
    ],
  },
  {
    name: "Hugging Face",
    brand: "Hugging Face",
    keyFormat: "hf_…",
    url: "https://huggingface.co/settings/tokens",
    urlLabel: "huggingface.co/settings/tokens",
    note: "Free Inference API on many open-weight models.",
    recommended: false,
    local: false,
    steps: [
      "Create an account at huggingface.co.",
      "Go to Settings → Access Tokens → Create new token.",
      "Choose Read or Write role and copy the key (starts with hf_).",
      "Paste it into OrcaChat to use open-weight models (Llama, Mistral, OLMo, EuroLLM…).",
    ],
  },
];

// Providers auto-detected purely from the API key prefix.
const AUTO_DETECTED = [
  "OpenRouter",
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "Groq",
  "Hugging Face",
  "Mistral",
  "DeepSeek",
  "Cohere",
  "X.AI (Grok)",
  "Together",
  "Fireworks",
  "DeepInfra",
  "Qwen (Alibaba)",
  "MiniMax",
  "NVIDIA",
  "Aleph Alpha",
  "GitHub Copilot",
];

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-[11px] font-medium text-[#8b949e] transition hover:border-[#1f6feb] hover:text-[#c9d1d9]"
    >
      {copied ? (
        <>
          <Check size={12} className="text-[#3fb950]" />
          Copied
        </>
      ) : (
        <>
          <Copy size={12} />
          Copy
        </>
      )}
    </button>
  );
}

const RESET_CODE = `// Remove all OrcaChat settings, keys & preferences
Object.keys(localStorage)
  .filter((k) => k.startsWith("orcachat"))
  .forEach((k) => localStorage.removeItem(k));

// Delete the chat database (all conversations)
indexedDB.deleteDatabase("orcachat_chats");
`.trim();

const FULL_RESET_CODE = `// Backup: the browser will ask for confirmation
localStorage.clear();

// Delete the chat database (all conversations)
indexedDB.deleteDatabase("orcachat_chats");
`.trim();

function IntroBanner() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
      <ShieldCheck
        size={18}
        className="mt-0.5 shrink-0 text-[#58a6ff]"
        aria-hidden="true"
      />
      <div className="space-y-1 text-[12.5px] leading-relaxed text-[#8b949e]">
        <p>
          <span className="font-semibold text-[#e6edf3]">
            All of your data stays on this device.
          </span>{" "}
          Conversations, models, settings and API keys are stored locally in
          this browser only — nothing is uploaded to a server.
        </p>
        <p>
          OrcaChat ships with a free tier (no key required) and supports
          bring-your-own models for unlimited use.
        </p>
      </div>
    </div>
  );
}

export default function Guide({ onClose }: GuideProps) {
  const [tab, setTab] = useState<TabId>("keys");
  const isLight = getTheme() === "light";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[min(640px,85vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#21262d] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/orca-logo.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-6 w-6 object-contain select-none"
                style={{
                  filter: isLight ? "invert(1) brightness(0)" : "none",
                }}
              />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold text-[#e6edf3]">
                Setup guide
              </h2>
              <p className="text-[11px] text-[#8b949e]">
                Connect a model, check what&apos;s supported, and start fresh
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close guide"
            className="rounded-md p-1.5 text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[#21262d] px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium transition ${
                tab === t.id
                  ? "border-[#58a6ff] text-[#e6edf3]"
                  : "border-transparent text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tab === "keys" && (
            <div className="space-y-5">
              <IntroBanner />

              <div className="space-y-3">
                {PROVIDER_GUIDES.map((p) => (
                  <div
                    key={p.name}
                    className="overflow-hidden rounded-md border border-[#30363d] bg-[#0d1117]"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-[#21262d] px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#21262d] text-[11px] font-semibold text-[#8b949e]">
                          {p.brand.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#e6edf3]">
                            {p.name}
                            {p.local && (
                              <span className="rounded-md bg-[#21262d] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#8b949e]">
                                Local
                              </span>
                            )}
                            {p.recommended && (
                              <span className="rounded-md bg-[#1f6feb]/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#58a6ff]">
                                Recommended
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-[#8b949e]">
                            Key format:{" "}
                            <span className="font-mono">{p.keyFormat}</span>
                          </p>
                        </div>
                      </div>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-[11px] font-medium text-[#8b949e] transition hover:border-[#1f6feb] hover:text-[#58a6ff]"
                      >
                        <ExternalLink size={11} />
                        Visit
                      </a>
                    </div>

                    <div className="px-4 py-3">
                      <p className="mb-3 flex items-center gap-1.5 text-[12px] text-[#8b949e]">
                        <Check size={13} className="shrink-0 text-[#58a6ff]" />
                        {p.note}
                      </p>
                      <ol className="space-y-1.5">
                        {p.steps.map((s, j) => (
                          <li
                            key={j}
                            className="flex gap-2.5 text-[12.5px] leading-relaxed text-[#8b949e]"
                          >
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#21262d] text-[10px] font-semibold text-[#8b949e]">
                              {j + 1}
                            </span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ))}
              </div>

              <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-[#8b949e]">
                <KeyRound size={12} className="shrink-0" />
                For any other OpenAI-compatible provider, paste the provider API
                URL together with your key. Typing a model name (for example
                “EuroLLM”, “OLMo”, “Mistral”) also works.
              </p>
            </div>
          )}

          {tab === "models" && (
            <div className="space-y-6">
              {/* Free tier */}
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#e6edf3]">
                  <Check size={14} className="text-[#58a6ff]" />
                  Out of the box — no key required
                </h3>
                <div className="rounded-md border border-[#30363d] bg-[#0d1117] px-4 py-3">
                  <p className="text-[12.5px] leading-relaxed text-[#8b949e]">
                    Every chat starts with a{" "}
                    <span className="font-medium text-[#e6edf3]">
                      free tier of 10 responses
                    </span>
                    . No API key or account needed — opening a new chat refreshes
                    the allowance. Add your own model for unlimited use.
                  </p>
                </div>
              </section>

              {/* Auto-detected */}
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#e6edf3]">
                  <KeyRound size={14} className="text-[#58a6ff]" />
                  With your own API key
                </h3>
                <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                  <p className="mb-3 text-[12px] leading-relaxed text-[#8b949e]">
                    OrcaChat identifies the provider automatically from your key
                    prefix and/or API URL. These work with just a key:
                  </p>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {AUTO_DETECTED.map((name) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 text-[12px] text-[#c9d1d9]"
                      >
                        <span className="h-1 w-1 shrink-0 rounded-full bg-[#58a6ff]/60" />
                        {name}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-[12px] text-[#c9d1d9] sm:col-span-2">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-[#58a6ff]/60" />
                      Any other OpenAI-compatible endpoint (type the model name)
                    </div>
                  </div>
                </div>
              </section>

              {/* Local */}
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#e6edf3]">
                  <Cpu size={14} className="text-[#58a6ff]" />
                  Local models — fully private
                </h3>
                <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                  <ul className="space-y-1.5 text-[12px] text-[#c9d1d9]">
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-[#58a6ff]/60" />
                      Ollama — any model via http://localhost:11434
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-[#58a6ff]/60" />
                      LM Studio — any GGUF model via http://localhost:1234/v1
                    </li>
                  </ul>
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[#8b949e]">
                    <ShieldCheck size={12} className="shrink-0" />
                    No key, no cloud — every response is processed on your
                    device.
                  </p>
                </div>
              </section>
            </div>
          )}

          {tab === "reset" && (
            <div className="space-y-6">
              <IntroBanner />

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#e6edf3]">
                  <Database size={14} className="text-[#58a6ff]" />
                  Clear everything to start fresh
                </h3>
                <p className="mb-1 text-[12.5px] leading-relaxed text-[#8b949e]">
                  If you want to hand the device to someone else, or simply begin
                  again as a brand-new user, you can wipe every trace of
                  OrcaChat. Because all data lives in this browser, a full reset
                  makes the site behave exactly as it did on first open.
                </p>
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                <h4 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[#e6edf3]">
                  <Terminal size={13} className="text-[#58a6ff]" />
                  Option A — Remove only OrcaChat data
                </h4>
                <p className="mb-3 text-[12px] leading-relaxed text-[#8b949e]">
                  Open the browser console (F12 → Console), paste this, and press
                  Enter. It removes your settings, keys and conversations while
                  leaving the rest of the site untouched:
                </p>
                <div className="overflow-hidden rounded-md border border-[#30363d]">
                  <pre className="overflow-x-auto bg-[#0d1117] p-4 font-mono text-[11.5px] leading-relaxed text-[#58a6ff]">{RESET_CODE}</pre>
                  <div className="flex items-center justify-between gap-3 border-t border-[#30363d] bg-[#161b22] px-4 py-2">
                    <span className="truncate text-[11px] text-[#8b949e]">
                      Clears first-run state, models, keys &amp; chat history.
                    </span>
                    <CopyCode code={RESET_CODE} />
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                <h4 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[#e6edf3]">
                  <Terminal size={13} className="text-[#58a6ff]" />
                  Option B — Full browser reset
                </h4>
                <p className="mb-3 text-[12px] leading-relaxed text-[#8b949e]">
                  Paste this to clear everything stored for this site, including
                  any third-party data. The browser will ask you to confirm
                  before clearing:
                </p>
                <div className="overflow-hidden rounded-md border border-[#30363d]">
                  <pre className="overflow-x-auto bg-[#0d1117] p-4 font-mono text-[11.5px] leading-relaxed text-[#58a6ff]">{FULL_RESET_CODE}</pre>
                  <div className="flex items-center justify-between gap-3 border-t border-[#30363d] bg-[#161b22] px-4 py-2">
                    <span className="truncate text-[11px] text-[#8b949e]">
                      The most thorough option — wipes every local storage key.
                    </span>
                    <CopyCode code={FULL_RESET_CODE} />
                  </div>
                </div>
              </section>

              <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-[#8b949e]">
                <ShieldCheck size={12} className="shrink-0" />
                After running either snippet, reload the page. OrcaChat will
                treat you as a first-time visitor and reset your free-tier
                allowance.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#21262d] px-6 py-3">
          <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-[#8b949e]">
            <ShieldCheck size={11} />
            Your API keys and conversations are stored locally in this browser
            only.
          </p>
        </div>
      </div>
    </div>
  );
}
