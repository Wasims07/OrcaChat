"use client";

import { useState, useEffect } from "react";
import {
  Plus,
  PanelLeftClose,
  User,
} from "lucide-react";

import ChatHistory from "@/components/Sidebar/ChatHistory";
import UserMenu from "@/components/Sidebar/UserMenu";
import SettingsModal from "@/components/Settings/SettingsModal";
import {
  getUserName,
  PROFILE_UPDATED_EVENT,
  getTheme,
  THEME_UPDATED_EVENT,
} from "@/lib/profile";

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  activeChatId?: string | null;
  onNewChat?: () => void;
  onSelectChat?: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
  onRequestOpen?: () => void;
};

export default function Sidebar({
  isOpen,
  onClose,
  activeChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRequestOpen,
}: SidebarProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsLegalView, setSettingsLegalView] = useState<
    "terms" | "privacy" | null
  >(null);
  const [userName, setUserName] = useState(getUserName);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  // ✅ Hydrate profile (SSR-safe) and stay in sync with edits
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Defer the initial hydration read so SSR output and the first client
    // render stay identical (avoids a React hydration mismatch) while keeping
    // synchronous setState out of the effect body.
    const t = setTimeout(() => {
      setMounted(true);
      setTheme(getTheme());
    }, 0);
    const onProfile = () => {
      setUserName(getUserName());
    };
    const onTheme = () => setTheme(getTheme());
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfile);
    window.addEventListener(THEME_UPDATED_EVENT, onTheme);
    return () => {
      clearTimeout(t);
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfile);
      window.removeEventListener(THEME_UPDATED_EVENT, onTheme);
    };
  }, []);

  // Open Settings directly into a legal view (e.g. from the Privacy Notice),
  // re-opening the sidebar if needed so the modal stays reachable.
  useEffect(() => {
    const openSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { view?: "terms" | "privacy" }
        | undefined;
      onRequestOpen?.();
      setSettingsLegalView(detail?.view ?? null);
      setShowSettings(true);
    };
    window.addEventListener("orcachat-open-settings", openSettings);
    return () =>
      window.removeEventListener("orcachat-open-settings", openSettings);
  }, [onRequestOpen]);

  // After choosing a chat on a narrow (mobile/tablet) screen, close the
  // overlay drawer so the chat fills the viewport. Desktops are unaffected
  // because the sidebar stays docked there.
  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      onClose();
    }
  };

  const handleNewChatClick = () => {
    onNewChat?.();
    closeOnMobile();
  };

  const handleSelectChat = (id: string) => {
    onSelectChat?.(id);
    closeOnMobile();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Mobile backdrop — only visible under the lg breakpoint */}
      <div
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="
          dc-sidebar
          fixed
          inset-y-0
          left-0
          z-50
          flex
          w-[280px]
          max-w-[85vw]
          flex-col
          overflow-hidden
          border-r
          border-[#21262d]
          bg-[#0d1117]
          shadow-2xl
          animate-in
          slide-in-from-left
          duration-200

          lg:relative
          lg:z-40
          lg:max-w-none
          lg:shrink-0
          lg:shadow-none
          lg:animate-none
        "
      >
        {/* =====================
            HEADER — BRAND
        ===================== */}

        <div className="relative flex h-[60px] shrink-0 items-center px-4 border-b border-[#21262d]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/orca-logo.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            className="mr-2.5 h-8 w-8 shrink-0 object-contain transition select-none"
            style={{
              filter:
                mounted && theme === "light"
                  ? "invert(1) brightness(0)"
                  : "none",
            }}
          />
          <div className="leading-none">
            <span className="block text-[16px] font-semibold tracking-[-0.01em] text-[#c9d1d9]">
              OrcaChat
            </span>
            <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-[#8b949e]">
              Workspace
            </span>
          </div>

          <button
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-[#8b949e] transition-all hover:bg-[#21262d] hover:text-[#c9d1d9] active:scale-95"
            title="Close sidebar"
          >
            <PanelLeftClose size={17} strokeWidth={1.6} />
          </button>
        </div>

        {/* =====================
            NEW CHAT
        ===================== */}

        <div className="px-3 pt-3">
          <button
            onClick={handleNewChatClick}
            className="dc-new-chat group relative flex h-[42px] w-full items-center gap-2.5 overflow-hidden rounded-md border border-[#30363d] bg-[#21262d] px-3.5 text-left text-[14px] font-medium text-[#c9d1d9] transition-all duration-200 hover:border-[#3fb950] hover:bg-[#30363d] active:scale-[0.99]"
          >
            <Plus size={17} strokeWidth={2} className="text-[#8b949e] transition-transform duration-200 group-hover:rotate-90 group-hover:text-[#c9d1d9]" />
            <span>New Chat</span>
          </button>
        </div>

        {/* DIVIDER */}

        <div className="mx-4 my-3 border-t border-[#21262d]" />

        {/* =====================
            CHAT HISTORY
        ===================== */}

        <ChatHistory
          onSelectChat={handleSelectChat}
          onDeleteChat={onDeleteChat}
          activeChatId={activeChatId}
        />

        {/* =====================
            USER SECTION
        ===================== */}

        <div className="relative shrink-0 border-t border-[#21262d] bg-[#161b22] p-2.5">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="dc-profile-btn group flex h-[52px] w-full items-center gap-3 rounded-md px-2.5 text-left transition-all hover:bg-[#21262d]"
          >
            {/* AVATAR */}
            <div className="relative shrink-0">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#21262d] text-[#8b949e]">
                <User size={18} strokeWidth={2} />
              </div>
            </div>

            {/* USER INFO */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium leading-5 text-[#c9d1d9]">
                {userName}
              </p>
              <p className="truncate text-[12px] leading-4 text-[#8b949e]">
                Privacy-first AI chat
              </p>
            </div>

            {/* THREE DOTS */}
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-md text-[#8b949e] transition-all ${
                showUserMenu
                  ? "bg-[#21262d] text-[#c9d1d9]"
                  : "group-hover:bg-[#21262d] group-hover:text-[#c9d1d9]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="8" cy="13" r="1.4" />
              </svg>
            </span>
          </button>

          {/* User Menu */}
          {showUserMenu && (
            <UserMenu
              onClose={() => setShowUserMenu(false)}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
        </div>
      </aside>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => {
          setShowSettings(false);
          setSettingsLegalView(null);
        }}
        onOpenChat={onSelectChat}
        openLegalView={settingsLegalView}
      />
    </>
  );
}