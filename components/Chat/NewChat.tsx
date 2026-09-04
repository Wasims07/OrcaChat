"use client";

import { useState, useEffect } from "react";
import { ShieldCheck, KeyRound, Globe } from "lucide-react";
import { getTheme, THEME_UPDATED_EVENT } from "@/lib/profile";

export default function NewChat() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      setMounted(true);
      setTheme(getTheme());
    }, 0);
    const onTheme = () => setTheme(getTheme());
    window.addEventListener(THEME_UPDATED_EVENT, onTheme);
    return () => {
      clearTimeout(t);
      window.removeEventListener(THEME_UPDATED_EVENT, onTheme);
    };
  }, []);

  const badges = [
    { icon: <ShieldCheck size={14} />, label: "Runs 100% locally" },
    { icon: <KeyRound size={14} />, label: "Bring your own key" },
    { icon: <Globe size={14} />, label: "Web search built-in" },
  ];

  return (
    <div className="flex flex-col items-center px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/orca-logo.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="mb-8 h-24 w-24 object-contain transition select-none"
        style={{
          filter:
            mounted && theme === "light" ? "invert(1) brightness(0)" : "none",
        }}
      />
      <h1 className="text-center text-[28px] font-bold leading-tight tracking-[-0.04em] text-[#e6edf3] sm:text-[42px]">
        What can I help with?
      </h1>
      <p className="mt-2 text-center text-[15px] text-[#8b949e] sm:text-[16px]">
        Enter your own key, Take guide to use unlimited chats
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {badges.map((b) => (
          <span
            key={b.label}
            className="flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-[11.5px] font-medium text-[#8b949e]"
          >
            {b.icon}
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}