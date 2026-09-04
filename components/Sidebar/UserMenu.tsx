"use client";

import { useState, useRef, useEffect } from "react";
import { Settings as SettingsIcon } from "lucide-react";

import { getUserName } from "@/lib/profile";

type UserMenuProps = {
  onClose: () => void;
  onOpenSettings: () => void;
};

export default function UserMenu({ onClose, onOpenSettings }: UserMenuProps) {
  const [name] = useState(getUserName);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <>
      <div
        ref={menuRef}
        className="
          dc-popover
          absolute
          left-2
          right-2
          bottom-[64px]
          z-[100]
          overflow-hidden
          rounded-md
          border
          border-[#30363d]
          bg-[#161b22]
          p-1.5
          shadow-[0_24px_60px_rgba(0,0,0,0.6)]
          ring-1
          ring-black/50
          animate-in
          slide-in-from-bottom-4
          duration-200
        "
      >
        <div className="px-2.5 py-2 border-b border-[#21262d]">
          <p className="text-[13px] font-semibold text-[#e6edf3]">{name}</p>
          <p className="text-[11px] text-[#8b949e]">OrcaChat User</p>
        </div>

        <MenuItem
          icon={<SettingsIcon size={14} strokeWidth={1.7} />}
          title="Settings"
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        />
      </div>
    </>
  );
}

/* =========================================
   MENU ITEM
========================================= */

function MenuItem({
  icon,
  title,
  danger = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex
        h-[34px]
        w-full
        items-center
        gap-2.5
        rounded-md
        px-2.5
        text-left
        text-[13px]
        font-normal
        transition-all
        duration-150

        ${danger
          ? "text-[#f85149] hover:bg-[#f85149]/10"
          : "text-[#c9d1d9] hover:bg-[#1c2128] hover:text-white active:bg-[#21262d]"
        }
      `}
    >
      <span
        className={`
          flex
          w-4
          shrink-0
          items-center
          justify-center

          ${danger ? "text-[#f85149]" : "text-[#8b949e]"}
        `}
      >
        {icon}
      </span>

      <span className="truncate text-[13px]">{title}</span>
    </button>
  );
}
