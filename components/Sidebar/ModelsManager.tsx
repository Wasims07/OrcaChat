"use client";

import { useState, useEffect } from "react";
import { X, Plus, Key, Trash2, Cpu, KeyRound, Link2, ShieldCheck } from "lucide-react";

import {
  getCustomModels,
  saveCustomModel,
  removeCustomModel,
  resolveModelFromUrl,
  resolveFromKey,
  resolveFromName,
  describeProvider,
  storeSelectedModel,
  CustomModel,
} from "@/lib/modelStore";
import { getTheme, THEME_UPDATED_EVENT } from "@/lib/profile";
import { getAnonClientToken } from "@/lib/clientToken";

type ModelsManagerProps = {
  onClose: () => void;
};

export default function ModelsManager({ onClose }: ModelsManagerProps) {
  const [models, setModels] = useState<CustomModel[]>([]);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => setTheme(getTheme()), 0);
    const onTheme = () => setTheme(getTheme());
    window.addEventListener(THEME_UPDATED_EVENT, onTheme);
    return () => {
      clearTimeout(t);
      window.removeEventListener(THEME_UPDATED_EVENT, onTheme);
    };
  }, []);

  const refresh = () => {
    getCustomModels().then(setModels);
  };

  useEffect(() => {
    refresh();
    const reload = () => refresh();
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, []);

  // Detect the provider + default model id from the base URL when given,
  // otherwise fall back to detecting it from the API key (or, last, from the
  // friendly model name). The URL is optional — a user can add a model with
  // just a name + key. Console URLs (console.mistral.ai, platform.deepseek.com,
  // …) are recognized and rewritten to the real API base automatically.
  const urlDerived = resolveModelFromUrl(baseUrl.trim());
  const keyDerived = resolveFromKey(apiKey.trim());
  const nameDerived = resolveFromName(name.trim());

  const hasUrl = baseUrl.trim().length > 0;
  const urlModel = urlDerived.modelId;
  const nameModel = nameDerived.modelId;
  const keyModel = keyDerived.modelId;

  // Prefer the most specific signal: explicit URL > typed model name > key
  // prefix. When an explicit URL is unrecognized we keep it as the endpoint
  // and still fill the model id from the name/key so the model gets added.
  let effectiveModelId: string;
  let effectiveBaseUrl: string;
  let effectiveProvider: string;

  if (hasUrl) {
    effectiveBaseUrl = urlModel ? urlDerived.baseUrl : baseUrl.trim();
    effectiveModelId = urlModel || nameModel || keyModel || "";
    effectiveProvider = urlModel
      ? urlDerived.provider
      : nameModel
      ? nameDerived.provider
      : keyModel
      ? keyDerived.provider
      : "OpenAI-compatible";
  } else if (nameModel) {
    effectiveBaseUrl = nameDerived.baseUrl;
    effectiveModelId = nameModel;
    effectiveProvider = nameDerived.provider;
  } else if (keyModel) {
    effectiveBaseUrl = keyDerived.baseUrl;
    effectiveModelId = keyModel;
    effectiveProvider = keyDerived.provider;
  } else {
    effectiveBaseUrl = "";
    effectiveModelId = "";
    effectiveProvider = "Unknown";
  }

  const handleAdd = async () => {
    const cleanName = name.trim();
    const cleanApiKey = apiKey.trim();
    const cleanModelId = effectiveModelId;
    const cleanBaseUrl = effectiveBaseUrl;

    if (!cleanName) {
      setError("Please enter a name for this model.");
      return;
    }
    if (!cleanApiKey) {
      setError("Please enter your API key.");
      return;
    }
    if (!cleanModelId) {
      setError(
        "Could not identify this provider. Paste the provider's API base URL (e.g. https://api.mistral.ai/v1) or use a recognizable model name so the key can be verified."
      );
      return;
    }
    if (!cleanBaseUrl) {
      setError(
        "Could not identify an API endpoint for this key. Paste the provider's API base URL (e.g. https://api.mistral.ai/v1)."
      );
      return;
    }

    setError(null);
    setNotice(null);
    setValidating(true);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Token": getAnonClientToken(),
        },
        body: JSON.stringify({
          apiKey: cleanApiKey,
          baseUrl: cleanBaseUrl,
          modelId: cleanModelId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.valid) {
        setError(
          data.message ||
            data.error ||
            "This API key was rejected by its provider."
        );
        setValidating(false);
        return;
      }
      // The key authenticated, but the account is rate-limited / over quota.
      // Still save it (it works once the limit resets) while warning the user.
      if (data.status === "rate_limited") {
        setNotice(data.message);
      }
    } catch {
      setError(
        "Could not reach the provider to verify the key. Please check your connection and try again."
      );
      setValidating(false);
      return;
    }

    await saveCustomModel({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanName,
      modelId: cleanModelId,
      apiKey: cleanApiKey,
      baseUrl: cleanBaseUrl,
      createdAt: Date.now(),
    });
    refresh();
    // Make the freshly added model the active one right away.
    await storeSelectedModel(cleanModelId);
    window.dispatchEvent(
      new CustomEvent("model-selected", {
        detail: {
          modelId: cleanModelId,
          apiKey: cleanApiKey,
          baseUrl: cleanBaseUrl,
          name: cleanName,
        },
      })
    );
    setName("");
    setApiKey("");
    setBaseUrl("");
    setError(null);
    setValidating(false);
  };

  const handleRemove = async (id: string) => {
    await removeCustomModel(id);
    refresh();
  };

  return (
    <div
      className="
        fixed
        inset-0
        z-[200]
        flex
        items-center
        justify-center
        p-3
        sm:p-4
        bg-transparent
      "
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="
          flex
          h-[min(640px,85vh)]
          w-full
          max-w-lg
          flex-col
          overflow-hidden
          rounded-md
          border
          border-[#30363d]
          bg-[#161b22]
          p-6
          shadow-2xl
          animate-in
          zoom-in-95
          duration-200
        "
      >
        <div className="flex items-center justify-between mb-4">
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
                  filter:
                    theme === "light" ? "invert(1) brightness(0)" : "none",
                }}
              />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold text-[#e6edf3]">Models</h2>
              <p className="text-[11px] text-[#8b949e]">
                Add custom models with your own API keys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9] transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-t border-[#30363d] mb-3" />

        {/* Add Model Form */}
        <div className="space-y-2.5">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#8b949e]">
              Model name
            </label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNotice(null);
              }}
              placeholder="e.g. My Assistant, GPT-5, Llama 3"
              className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3.5 py-2.5 text-[14px] text-[#c9d1d9] placeholder-[#484f58] outline-none focus:border-[#1f6feb] transition"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#8b949e]">
              API URL <span className="text-[#8b949e]">(optional)</span>
            </label>
            <div className="relative">
              <Link2
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8b949e]"
              />
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setNotice(null);
                }}
                placeholder="e.g. https://api.mistral.ai/v1 (optional — a console URL like console.mistral.ai also works)"
                className="w-full rounded-md border border-[#30363d] bg-[#0d1117] py-2.5 pl-10 pr-3 text-[14px] text-[#c9d1d9] placeholder-[#484f58] outline-none focus:border-[#1f6feb] transition"
              />
            </div>
            {effectiveProvider !== "Unknown" && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#8b949e]">
                <Cpu size={11} className="text-[#58a6ff]" />
                Provider: <span className="text-[#c9d1d9]">{effectiveProvider}</span>
                <span className="text-[#8b949e]">· Model:</span>
                <span className="font-mono text-[#c9d1d9]">{effectiveModelId}</span>
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#8b949e]">
              API key
            </label>
            <div className="relative">
              <KeyRound
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8b949e]"
              />
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setNotice(null);
                }}
                placeholder="Paste your API key"
                className="w-full rounded-md border border-[#30363d] bg-[#0d1117] py-2.5 pl-10 pr-16 text-[14px] text-[#c9d1d9] placeholder-[#484f58] outline-none focus:border-[#1f6feb] transition"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#8b949e] hover:text-[#c9d1d9] transition"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-[12px] text-[#f85149]">
              <ShieldCheck size={13} />
              {error}
            </p>
          )}
          {notice && (
            <p className="flex items-center gap-1.5 text-[12px] text-[#d29922]">
              <ShieldCheck size={13} />
              {notice}
            </p>
          )}
          <button
            type="button"
            onClick={handleAdd}
            disabled={validating}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#1f6feb]/10 border border-[#1f6feb]/20 py-2.5 text-[13px] font-medium text-[#58a6ff] transition hover:bg-[#1f6feb]/20 hover:text-[#79c0ff] disabled:opacity-60 disabled:cursor-wait"
          >
            {validating ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#58a6ff]/30 border-t-[#58a6ff]" />
                Verifying key…
              </>
            ) : (
              <>
                <Plus size={15} />
                Add Model
              </>
            )}
          </button>
          <p className="text-center text-[10.5px] text-[#8b949e]">
            The API key is checked against your provider before saving. Only
            valid keys are added.
          </p>
        </div>

        {/* Custom Models List */}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {models.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#21262d] mb-3">
                <Key size={20} className="text-[#8b949e]" />
              </div>
              <p className="text-sm text-[#8b949e]">No custom models yet</p>
              <p className="mt-1 text-xs text-[#8b949e] max-w-[280px]">
                Add a model with a name + API key (URL optional). OrcaChat
                checks the key and supports free &amp; paid models from any
                provider.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {models.map((model) => (
                <div
                  key={model.id}
                  className="group flex items-center gap-2.5 rounded-md border border-[#30363d] bg-[#21262d] px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#30363d] text-[#58a6ff]">
                    <Cpu size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[#c9d1d9]">
                      {model.name}
                    </p>
                    <p className="flex items-center gap-1 truncate text-[11px] text-[#8b949e]">
                      <Cpu size={11} />
                      {describeProvider(model.modelId)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemove(model.id)}
                    className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#f85149]/10 hover:text-[#f85149] transition"
                    title="Delete model"
                  >
                    <Trash2 size={14} strokeWidth={1.7} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-[10px] text-[#8b949e]">
          Your API keys are stored locally in this browser only
        </p>
      </div>
    </div>
  );
}