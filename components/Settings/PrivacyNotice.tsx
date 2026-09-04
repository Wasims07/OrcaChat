"use client";

import { useState, useEffect } from "react";
import {
  ShieldCheck,
  Lock,
  Globe,
  Server,
  Cookie,
  ExternalLink,
  Check,
} from "lucide-react";

import {
  hasSeenPrivacyNotice,
  hasPrivacyConsent,
  grantPrivacyConsent,
  markPrivacyNoticeSeen,
} from "@/lib/profile";

type PrivacyNoticeProps = {
  onOpenPrivacy: () => void;
};

const HIGHLIGHTS = [
  {
    icon: Lock,
    title: "Local-first storage",
    desc: "Your chats are encrypted and stored on your device via IndexedDB. Nothing is uploaded to our servers.",
  },
  {
    icon: Globe,
    title: "Online model providers",
    desc: "When using online models (OpenRouter, OpenAI, Claude, etc.), your current prompt is sent to that provider to generate a reply.",
  },
  {
    icon: Server,
    title: "No tracking, no analytics",
    desc: "We do not use tracking cookies, analytics scripts, or behavioral fingerprinting of any kind.",
  },
  {
    icon: Cookie,
    title: "No personal data collection",
    desc: "No email, phone number, or account required. Preferences are stored locally in your browser only.",
  },
];

export default function PrivacyNotice({ onOpenPrivacy }: PrivacyNoticeProps) {
  const [visible, setVisible] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!hasSeenPrivacyNotice() && !hasPrivacyConsent()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const accept = () => {
    grantPrivacyConsent();
    setAcknowledged(true);
    setTimeout(() => setVisible(false), 600);
  };

  const dismiss = () => {
    markPrivacyNoticeSeen();
    setAcknowledged(true);
    setTimeout(() => setVisible(false), 600);
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`
          relative flex w-full max-w-lg flex-col
          max-h-[90vh]
          rounded-lg border border-[#30363d] bg-[#0d1117]
          shadow-[0_32px_80px_rgba(0,0,0,0.7)]
          animate-in zoom-in-95 duration-300
          max-sm:max-w-[92vw] max-sm:max-h-[85vh]
          ${acknowledged ? "animate-out zoom-out-95 fade-out duration-300" : ""}
        `}
      >
        {/* Top accent line */}
        <div className="h-[2px] w-full shrink-0 rounded-t-lg bg-gradient-to-r from-transparent via-[#1f6feb] to-transparent" />

        {/* Header with OrcaChat logo */}
        <div className="flex shrink-0 items-center justify-center gap-2.5 px-6 pt-5 pb-2 max-sm:px-4 max-sm:pt-4 max-sm:pb-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/orca-logo.png"
            alt="OrcaChat"
            width={32}
            height={32}
            className="h-8 w-8 rounded-md object-contain select-none max-sm:h-6 max-sm:w-6"
          />
          <span className="text-[17px] font-bold tracking-tight text-[#e6edf3] max-sm:text-[15px]">
            OrcaChat
          </span>
          <span className="ml-1 rounded-full border border-[#30363d] bg-[#21262d] px-2 py-0.5 text-[10px] font-medium text-[#8b949e]">
            Privacy
          </span>
        </div>

        {/* Scrollable content area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 max-sm:px-4 max-sm:py-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#1f6feb]/20 bg-[#1f6feb]/10 max-sm:h-8 max-sm:w-8">
              <ShieldCheck size={18} className="text-[#58a6ff] max-sm:h-4 max-sm:w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#e6edf3] max-sm:text-[13px]">
                How OrcaChat handles your data
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8b949e] max-sm:text-[12px]">
                We believe in transparency. Here&apos;s what happens with your data when
                you use OrcaChat.
              </p>
            </div>
          </div>

          {/* Highlight list */}
          <div className="mt-4 space-y-2.5 max-sm:mt-3 max-sm:space-y-2">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="flex gap-3 max-sm:gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] max-sm:h-7 max-sm:w-7">
                  <item.icon size={14} className="text-[#8b949e] max-sm:h-3.5 max-sm:w-3.5" />
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[13px] font-medium text-[#c9d1d9] max-sm:text-[12px]">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#8b949e] max-sm:text-[11.5px]">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="my-4 h-px bg-[#21262d] max-sm:my-3" />

          {/* Bottom note */}
          <p className="text-[11.5px] leading-relaxed text-[#6e7681] max-sm:text-[11px]">
            By continuing you acknowledge this notice. You can review our full
            privacy policy at any time from Settings.{" "}
            <button
              type="button"
              onClick={() => {
                markPrivacyNoticeSeen();
                setVisible(false);
                onOpenPrivacy();
              }}
              className="inline-flex items-center gap-0.5 font-medium text-[#58a6ff] transition hover:text-[#79c0ff]"
            >
              Privacy Policy
              <ExternalLink size={10} />
            </button>
          </p>
        </div>

        {/* Actions — pinned to bottom */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#21262d] bg-[#161b22] px-6 py-3 rounded-b-lg max-sm:px-4 max-sm:py-2.5">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-[#30363d] px-3.5 py-1.5 text-[12.5px] font-medium text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={accept}
            className="flex items-center gap-1.5 rounded-md bg-[#238636] px-4 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-[#2ea043]"
          >
            <Check size={14} strokeWidth={2.5} />
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
