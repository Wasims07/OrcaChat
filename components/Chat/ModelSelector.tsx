"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Cpu, KeyRound, Plus, Sparkles, Trash2 } from "lucide-react";

import {
  getCustomModels,
  removeCustomModel,
  describeProvider,
} from "@/lib/modelStore";

export type ModelOption = {
  id: string;
  name: string;
  provider: string;
  icon: React.ReactNode;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  custom?: boolean;
};

type ModelSelectorProps = {
  selectedModelId?: string;
  fallbackModelId?: string;
  onModelChange?: (model: {
    modelId: string;
    apiKey?: string;
    baseUrl?: string;
    name: string;
  }) => void;
};

async function toOptions(): Promise<ModelOption[]> {
  const customs = (await getCustomModels()).map((m) => ({
    id: m.id,
    name: m.name,
    provider: describeProvider(m.modelId),
    icon: <KeyRound size={14} />,
    modelId: m.modelId,
    apiKey: m.apiKey,
    baseUrl: m.baseUrl,
    custom: true,
  }));
  return customs;
}

export default function ModelSelector({
  selectedModelId,
  fallbackModelId = "",
  onModelChange = () => {},
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedId, setSelectedId] = useState(selectedModelId || "");
  const selectorRef = useRef<HTMLDivElement>(null);

  // ✅ Refresh custom models + sync selected id when dropdown opens
  useEffect(() => {
    let active = true;
    toOptions().then((opts) => {
      if (active) setModels(opts);
    });
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    // Sync local selection when the parent changes the selected model. The
    // sync setState here is intentional (API-driven prop -> local state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedModelId) setSelectedId(selectedModelId);
  }, [selectedModelId]);

  const currentModel = models.find((m) => m.modelId === selectedId) || null;

  const hasModels = models.length > 0;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        selectorRef.current &&
        !selectorRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (model: ModelOption) => {
    setSelectedId(model.modelId);
    onModelChange({
      modelId: model.modelId,
      apiKey: model.apiKey,
      baseUrl: model.baseUrl,
      name: model.name,
    });
    setIsOpen(false);
  };

  const handleDelete = async (model: ModelOption) => {
    await removeCustomModel(model.id);
    setModels((prev) => prev.filter((m) => m.id !== model.id));
    if (currentModel?.modelId === model.modelId) {
      setSelectedId(fallbackModelId);
      onModelChange({
        modelId: fallbackModelId,
        apiKey: "",
        baseUrl: "",
        name: "Base Model",
      });
    }
  };

  return (
    <div ref={selectorRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="dc-model-btn group flex h-9 items-center gap-2 rounded-md border border-[#30363d] bg-[#161b22] px-3.5 text-[12.5px] font-medium text-[#8b949e] transition-all hover:border-[#484f58] hover:bg-[#21262d] hover:text-[#c9d1d9]"
        title="Select model"
      >
        <Cpu size={13} className="text-[#8b949e] group-hover:text-[#58a6ff]" />
        <span className="max-w-[150px] truncate">
          {currentModel
            ? currentModel.name
            : hasModels
            ? "Select a model"
            : "Base Model"}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-[#8b949e] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="dc-selector-dropdown absolute right-0 top-[40px] z-50 w-[300px] overflow-hidden rounded-md border border-[#30363d] bg-[#161b22] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
          <div className="dc-dd-label px-2.5 pb-2 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[#8b949e]">
            {hasModels ? "Your models" : "Base Model"}
          </div>

          <div className="max-h-[300px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {hasModels ? (
              models.map((model) => {
                const isSelected = currentModel?.modelId === model.modelId;
                return (
                  <div
                    key={model.id}
                    className="dc-dd-item group flex items-center gap-1 rounded-md transition hover:bg-[#21262d]"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(model)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
                    >
                      <div className="dc-dd-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#21262d] text-[#8b949e]">
                        {model.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="dc-dd-name truncate text-[13px] text-[#c9d1d9]">
                          {model.name}
                        </div>
                        <div className="dc-dd-sub truncate text-[10px] text-[#8b949e]">
                          {model.provider}
                          <span className="ml-1.5 text-[#8b949e]">🔑 api key</span>
                        </div>
                      </div>
                      {isSelected && (
                        <Check size={15} className="shrink-0 text-[#3fb950]" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(model)}
                      className="mr-1.5 shrink-0 rounded-md p-1.5 text-[#8b949e] transition hover:bg-[#f85149]/10 hover:text-[#f85149]"
                      title={`Delete ${model.name}`}
                    >
                      <Trash2 size={14} strokeWidth={1.7} />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="px-2.5 py-3">
                <div className="flex items-center gap-2 text-[13px] text-[#c9d1d9]">
                  <Sparkles size={14} className="text-[#58a6ff]" />
                  <span>Base Model</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#8b949e]">
                  Free shared model — 10 runs per chat. New chat = fresh 10. Add
                  your own model (API key or local) for unlimited use.
                </p>
              </div>
            )}
          </div>

          <div className="mx-1 my-1.5 border-t border-[#30363d]" />
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              window.dispatchEvent(new Event("open-models-manager"));
            }}
            className="dc-dd-footer flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-[#21262d]"
          >
            <div className="dc-dd-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#21262d] text-[#58a6ff]">
              <Plus size={14} />
            </div>
            <span className="dc-dd-name text-[13px] text-[#c9d1d9]">
              Add your own model
            </span>
          </button>
        </div>
      )}
    </div>
  );
}