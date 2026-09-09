"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Settings as SettingsIcon,
  Info,
  Sun,
  Moon,
  Save,
  Archive,
  Trash2,
  ShieldCheck,
  ShieldX,
  ExternalLink,
} from "lucide-react";

import ConfirmDialog from "@/components/UI/ConfirmDialog";
import {
  clearAllChats,
  getArchivedChats,
  toggleArchiveChat,
  deleteChatSession,
  ChatSession,
} from "@/lib/chatStorage";
import {
  getUserName,
  setUserName,
  getTheme,
  setTheme,
  Theme,
  PROFILE_UPDATED_EVENT,
  THEME_UPDATED_EVENT,
  hasPrivacyConsent,
  getPrivacyConsent,
  revokePrivacyConsent,
  CONSENT_UPDATED_EVENT,
} from "@/lib/profile";

type Tab = "general" | "about" | "archived" | "clear";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenChat?: (chatId: string) => void;
  /** When provided, opens directly to this legal view (e.g. "privacy"). */
  openLegalView?: "terms" | "privacy" | null;
};

export default function SettingsModal({
  isOpen,
  onClose,
  onOpenChat,
  openLegalView = null,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("general");

  const [name, setName] = useState(getUserName);
  const [theme, setThemeState] = useState(getTheme);
  const [saved, setSaved] = useState(false);
  const [consented, setConsented] = useState(hasPrivacyConsent);
  const [consentDate, setConsentDate] = useState<string | null>(
    getPrivacyConsent()?.acceptedAt ?? null
  );

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [archivedChats, setArchivedChats] = useState<ChatSession[]>([]);
  const [legalView, setLegalView] = useState<null | "terms" | "privacy">(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Keep profile name & theme in sync with external changes (SSR-safe)
  useEffect(() => {
    const onProfile = () => {
      setName(getUserName());
    };
    const onTheme = () => setThemeState(getTheme());
    const onConsent = () => {
      setConsented(hasPrivacyConsent());
      setConsentDate(getPrivacyConsent()?.acceptedAt ?? null);
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfile);
    window.addEventListener(THEME_UPDATED_EVENT, onTheme);
    window.addEventListener(CONSENT_UPDATED_EVENT, onConsent);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfile);
      window.removeEventListener(THEME_UPDATED_EVENT, onTheme);
      window.removeEventListener(CONSENT_UPDATED_EVENT, onConsent);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Allow opening directly into a legal view (e.g. from the Privacy Notice).
  useEffect(() => {
    // Sync derived legal view from a one-shot prop. Intentional sync setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openLegalView) setLegalView(openLegalView);
  }, [openLegalView]);

  // When a legal view (Terms/Privacy) opens, snap the scrollable content to
  // the top so the document starts at its beginning, not mid-scroll.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [legalView, tab]);

  if (!isOpen) return null;

  const saveProfile = () => {
    setUserName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const closeModal = () => {
    setSaved(false);
    onClose();
  };

  const changeTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) closeModal();
  };

  const loadArchived = () => {
    const chats = getArchivedChats();
    chats.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    setArchivedChats(chats);
  };

  const openArchivedTab = () => {
    loadArchived();
    setTab("archived");
  };

  const handleUnarchive = (chatId: string) => {
    void toggleArchiveChat(chatId).then(loadArchived);
  };

  const handleOpenArchivedChat = (chatId: string) => {
    void toggleArchiveChat(chatId).then(() => {
      onOpenChat?.(chatId);
      closeModal();
    });
  };

  const handleDeleteArchived = (chatId: string) => {
    void deleteChatSession(chatId).then(loadArchived);
  };

  const getTimeDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours === 0 && minutes === 0) return "Just now";
    if (hours === 0) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const tabConfig: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "General", icon: <SettingsIcon size={15} /> },
    { id: "about", label: "About", icon: <Info size={15} /> },
    { id: "archived", label: "Archived Chats", icon: <Archive size={15} /> },
    { id: "clear", label: "Clear History", icon: <Trash2 size={15} /> },
  ];

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-transparent p-3 sm:p-4"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="flex h-[min(640px,85vh)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-[#30363d] bg-[#161b22] shadow-2xl animate-in zoom-in-95 duration-200"
      >
        {/* =============================
            HEADER
        ============================= */}
        <div className="flex items-center justify-between border-b border-[#21262d] px-6 py-4">
          <div className="flex items-center gap-2.5">
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
              <h2 className="text-[16px] font-semibold text-[#e6edf3]">Settings</h2>
              <p className="text-[11px] text-[#8b949e]">Customize your experience</p>
            </div>
          </div>
          <button
            onClick={closeModal}
            className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9] transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* =============================
            BODY
        ============================= */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs (left rail) */}
          <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#21262d] bg-[#0d1117] p-2 sm:w-44 sm:items-stretch sm:p-3">
            {tabConfig.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setLegalView(null);
                  if (t.id === "archived") openArchivedTab();
                  else setTab(t.id);
                }}
                className={`
                  flex items-center justify-center gap-2.5 rounded-md px-0 py-2 sm:justify-start sm:px-3 text-left text-[13.5px] font-medium transition-all
                  ${
                    tab === t.id
                      ? "bg-[#1f6feb]/15 text-[#79c0ff]"
                      : "text-[#8b949e] hover:bg-[#1c2128] hover:text-[#c9d1d9]"
                  }
                `}
                title={t.label}
              >
                <span className={tab === t.id ? "text-[#79c0ff]" : "text-[#8b949e]"}>
                  {t.icon}
                </span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
            {/* -------- LEGAL VIEW (Terms / Privacy) -------- */}
            {legalView && (
              <LegalDocument
                view={legalView}
                onBack={() => setLegalView(null)}
              />
            )}

            {/* -------- GENERAL TAB -------- */}
            {tab === "general" && !legalView && (
              <div className="flex flex-col">
                <h3 className="text-[14px] font-semibold text-[#e6edf3] mb-1">General</h3>

                <ProfileField
                  label="Your name"
                  value={name}
                  onChange={setName}
                  placeholder="Your name"
                />
                <p className="-mt-2 mb-5 text-[11px] text-[#8b949e]">
                  This name appears in the sidebar under your profile.
                </p>

                <h3 className="text-[14px] font-semibold text-[#e6edf3] mb-1">Appearance</h3>
                <p className="text-[12px] text-[#8b949e] mb-5">
                  Choose how OrcaChat looks for you.
                </p>

                <div className="flex gap-3">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => changeTheme("dark")}
                    onKeyDown={(e) => e.key === "Enter" && changeTheme("dark")}
                    className={`
                      flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-3.5 text-[13.5px] font-medium transition-all
                      ${
                        theme === "dark"
                          ? "border-[#1f6feb] bg-[#1f6feb]/15 text-[#e6edf3]"
                          : "border-[#30363d] bg-[#21262d] text-[#8b949e] hover:border-[#484f58]"
                      }
                    `}
                  >
                    <Moon size={16} className={theme === "dark" ? "text-[#79c0ff]" : "text-[#8b949e]"} />
                    Dark
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => changeTheme("light")}
                    onKeyDown={(e) => e.key === "Enter" && changeTheme("light")}
                    className={`
                      flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-3.5 text-[13.5px] font-medium transition-all
                      ${
                        theme === "light"
                          ? "border-[#1f6feb] bg-[#1f6feb]/15 text-[#e6edf3]"
                          : "border-[#30363d] bg-[#21262d] text-[#8b949e] hover:border-[#484f58]"
                      }
                    `}
                  >
                    <Sun size={16} className={theme === "light" ? "text-[#79c0ff]" : "text-[#8b949e]"} />
                    Light
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={saveProfile}
                    className="flex items-center gap-2 rounded-md bg-[#238636] px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-[#2ea043]"
                  >
                    <Save size={15} />
                    Save Changes
                  </button>
                  {saved && (
                    <span className="text-[12px] text-[#3fb950] animate-in fade-in duration-200">
                      Saved ✓
                    </span>
                  )}
                </div>

                {/* -------- PRIVACY & CONSENT -------- */}
                <h3 className="mt-9 text-[14px] font-semibold text-[#e6edf3] mb-1">
                  Privacy & Consent
                </h3>
                <p className="text-[12px] text-[#8b949e] mb-5">
                  We don&apos;t use tracking cookies and collect no email or
                  phone. You can review or withdraw your consent at any time.
                </p>

                <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#30363d] bg-[#0d1117] px-4 py-3.5">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${
                      consented
                        ? "border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]"
                        : "border-[#30363d] bg-[#21262d] text-[#8b949e]"
                    }`}
                  >
                    {consented ? (
                      <ShieldCheck size={18} />
                    ) : (
                      <ShieldX size={18} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[#e6edf3]">
                      {consented ? "Consent recorded" : "No consent recorded"}
                    </p>
                    <p className="text-[12px] text-[#8b949e]">
                      {consented && consentDate
                        ? `Accepted on ${new Date(consentDate).toLocaleDateString()}`
                        : "You haven't accepted the privacy notice yet."}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setLegalView("privacy");
                        setTab("about");
                      }}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#30363d] px-2.5 py-1.5 text-[12px] font-medium text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9] sm:flex-none sm:justify-start"
                    >
                      Review
                      <ExternalLink size={11} />
                    </button>
                    {consented && (
                      <button
                        type="button"
                        onClick={() => revokePrivacyConsent()}
                        className="flex-1 rounded-md border border-[#f85149]/30 px-2.5 py-1.5 text-[12px] font-medium text-[#f85149] transition hover:bg-[#f85149]/10 sm:flex-none"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* -------- ABOUT TAB -------- */}
            {tab === "about" && !legalView && (
              <div className="flex flex-col">
                <div className="mb-6 flex flex-col items-center text-center">
                  <div className="mb-3 flex items-center gap-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/orca-logo.png"
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="h-8 w-8 object-contain transition select-none"
                      style={{
                        filter:
                          theme === "dark"
                            ? "none"
                            : "invert(1) brightness(0)",
                      }}
                    />
                    <h3 className="text-[16px] font-semibold text-[#e6edf3]">OrcaChat</h3>
                  </div>
                  <p className="text-[12px] text-[#8b949e]">Version 1.0.0</p>
                </div>

                <p className="text-[13px] text-[#8b949e] leading-relaxed text-center mb-6">
                  A modern AI chat platform built for privacy and performance.
                </p>

                <div className="mb-6 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                  <h4 className="mb-3 text-[13px] font-semibold text-[#e6edf3]">
                    Key Features
                  </h4>
                  <ul className="space-y-2 text-[12.5px] text-[#8b949e]">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-[#3fb950]">✓</span>
                      <span>
                        <strong className="font-medium text-[#c9d1d9]">Multi-provider support</strong>{" "}
                        — connect to OpenAI, Anthropic, Gemini, and more. Use your own API key or start free.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-[#3fb950]">✓</span>
                      <span>
                        <strong className="font-medium text-[#c9d1d9]">Privacy-first architecture</strong>{" "}
                        — your data stays on your device. No accounts, no tracking.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-[#3fb950]">✓</span>
                      <span>
                        <strong className="font-medium text-[#c9d1d9]">Built-in web search</strong>{" "}
                        — get real-time answers with sources directly in your chat.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-[#3fb950]">✓</span>
                      <span>
                        <strong className="font-medium text-[#c9d1d9]">File analysis</strong>{" "}
                        — upload PDFs, documents, and images for instant AI-powered insights.
                      </span>
                    </li>
                     <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-[#3fb950]">✓</span>
                      <span>
                        <strong className="font-medium text-[#c9d1d9]">Open &amp; extensible</strong>{" "}
                        — self-hostable, customizable, and designed to grow with your needs.
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setLegalView("terms")}
                    className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0d1117] px-4 py-3 text-[13.5px] font-medium text-[#c9d1d9] transition hover:border-[#484f58] hover:text-[#e6edf3]"
                  >
                    Terms of Service
                    <span className="text-[#8b949e]">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLegalView("privacy")}
                    className="flex items-center justify-between rounded-md border border-[#30363d] bg-[#0d1117] px-4 py-3 text-[13.5px] font-medium text-[#c9d1d9] transition hover:border-[#484f58] hover:text-[#e6edf3]"
                  >
                    Privacy Policy
                    <span className="text-[#8b949e]">→</span>
                  </button>
                </div>
              </div>
            )}

            {/* -------- ARCHIVED CHATS TAB -------- */}
            {tab === "archived" && !legalView && (
              <div className="flex flex-col">
                <h3 className="text-[14px] font-semibold text-[#e6edf3] mb-1">Archived Chats</h3>
                <p className="text-[12px] text-[#8b949e] mb-5">
                  {archivedChats.length} chat{archivedChats.length !== 1 ? "s" : ""} archived.
                  Click a chat to open it.
                </p>

                {archivedChats.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[220px] text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#21262d] mb-4">
                      <Archive size={28} className="text-[#8b949e]" />
                    </div>
                    <p className="text-[#8b949e] text-sm">No archived chats</p>
                    <p className="text-[#8b949e] text-xs mt-1">Chats you archive will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {archivedChats.map((chat) => (
                      <div
                        key={chat.id}
                        className="group flex items-center gap-2 rounded-md px-3 py-2.5 hover:bg-[#1c2128] transition"
                      >
                        <button
                          onClick={() => handleOpenArchivedChat(chat.id)}
                          title="Open conversation"
                          className="min-w-0 flex-1 truncate text-left text-[14px] text-[#8b949e] transition hover:text-[#c9d1d9]"
                        >
                          {chat.title || "New Chat"}
                        </button>
                        <span className="text-[10px] text-[#8b949e]">
                          {getTimeDisplay(chat.updatedAt)}
                        </span>
                        <button
                          onClick={() => handleUnarchive(chat.id)}
                          className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-[#58a6ff] transition"
                          title="Unarchive"
                        >
                          <Archive size={14} strokeWidth={1.7} />
                        </button>
                        <button
                          onClick={() => handleDeleteArchived(chat.id)}
                          className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#f85149]/10 hover:text-[#f85149] transition"
                          title="Delete"
                        >
                          <Trash2 size={14} strokeWidth={1.7} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* -------- CLEAR HISTORY TAB -------- */}
            {tab === "clear" && !legalView && (
              <div className="flex flex-col">
                <h3 className="text-[14px] font-semibold text-[#e6edf3] mb-1">Clear History</h3>
                <p className="text-[12px] text-[#8b949e] mb-5">
                  Permanently remove all stored conversations from this device.
                </p>

                <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4 mb-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#1f6feb]/10">
                      <Trash2 size={16} className="text-[#79c0ff]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-[#e6edf3]">Automatic cleanup</p>
                      <p className="text-[12px] text-[#8b949e] leading-relaxed">
                        Chats with no activity for more than 7 days are
                        automatically deleted to save space. Pinned chats are
                        never auto-deleted.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/5 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#f85149]/10">
                      <Trash2 size={20} className="text-[#f85149]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[#e6edf3]">Delete all conversations</p>
                      <p className="text-[12px] text-[#8b949e]">
                        This action cannot be undone. Archived and pinned chats will also be removed.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="mt-4 w-full rounded-md bg-[#da3633] px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-[#f85149]"
                  >
                    Clear All History
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clear History Confirmation */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear Chat History"
        message="Are you sure you want to delete all chat history? This cannot be undone."
        confirmText="Clear"
        cancelText="Cancel"
        onConfirm={() => {
          clearAllChats();
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
        danger
      />
    </div>
  );
}

/* =========================================
   PROFILE FIELD
========================================= */

function ProfileField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#c9d1d9]">
        {label}
        {required && <span className="ml-1 text-[#f85149]">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="
          h-11 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3.5
          text-[14px] text-[#c9d1d9] placeholder-[#484f58] outline-none transition
          focus:border-[#1f6feb] focus:bg-[#0d1117]
        "
      />
    </label>
  );
}

/* =========================================
   LEGAL DOCUMENT (Terms / Privacy)
========================================= */

function LegalDocument({
  view,
  onBack,
}: {
  view: "terms" | "privacy";
  onBack: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-[#21262d] bg-[#161b22]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-[#8b949e] transition hover:bg-[#1c2128] hover:text-[#c9d1d9]"
        >
          ← Back
        </button>
      </div>

      {view === "terms" ? <TermsDocument /> : <PrivacyDocument />}
    </div>
  );
}

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h4 className="mb-1.5 text-[13.5px] font-semibold text-[#e6edf3]">{title}</h4>
      <div className="text-[13px] leading-relaxed text-[#8b949e] space-y-2">{children}</div>
    </section>
  );
}

function LegalParagraph({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function LegalListItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="ml-4 list-disc text-[#8b949e]">
      <span className="text-[13px] leading-relaxed">{children}</span>
    </li>
  );
}

function TermsDocument() {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[#e6edf3] mb-1">Terms of Service</h3>
      <p className="text-[12px] text-[#8b949e] mb-4">
        Effective date: September 2026
      </p>

      <LegalSection title="1. Agreement to Terms">
        <LegalParagraph>
          By accessing or using OrcaChat (&quot;the Service&quot;), you agree to be bound by
          these Terms of Service. If you do not agree, you may not use the Service.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="2. Description of Service">
        <LegalParagraph>
          OrcaChat is an AI-powered chat platform that connects users to third-party
          language model providers. The Service acts as an interface; it does not
          generate AI outputs itself. All conversations are stored locally on your
          device and are not retained on our servers.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="3. User Responsibilities">
        <LegalParagraph>
          You are solely responsible for:
        </LegalParagraph>
        <ul className="space-y-1">
          <LegalListItem>Maintaining the confidentiality of your API keys, if applicable.</LegalListItem>
          <LegalListItem>All content you submit through the Service.</LegalListItem>
          <LegalListItem>Ensuring your use complies with applicable laws and the acceptable use policies of any third-party providers you connect to.</LegalListItem>
        </ul>
      </LegalSection>

      <LegalSection title="4. Acceptable Use">
        <LegalParagraph>
          You agree not to use the Service to generate or distribute content that is
          unlawful, harmful, fraudulent, or infringing. You may not attempt to disrupt,
          overload, or circumvent the technical limitations of the Service.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="5. Third-Party Providers">
        <LegalParagraph>
          AI model responses are provided by independent third-party services (e.g.,
          OpenAI, Anthropic, Google). Your use of these providers is subject to their
          respective terms and privacy policies. OrcaChat does not control, endorse,
          or guarantee the accuracy of outputs from third-party providers.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="6. Intellectual Property">
        <LegalParagraph>
          All rights in the Service&apos;s code, design, and branding are reserved.
          You retain full ownership of any content you create using the Service.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="7. Disclaimer of Warranties">
        <LegalParagraph>
          The Service is provided &quot;as is&quot; and &quot;as available&quot; without
          warranties of any kind. AI-generated outputs may be inaccurate or incomplete
          and should not be treated as professional advice.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="8. Limitation of Liability">
        <LegalParagraph>
          To the maximum extent permitted by law, OrcaChat shall not be liable for any
          indirect, incidental, special, or consequential damages arising from your use
          of the Service.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="9. Modifications">
        <LegalParagraph>
          We reserve the right to update these Terms at any time. Material changes will
          be reflected in the Service. Continued use after changes take effect
          constitutes acceptance.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="10. Contact">
        <LegalParagraph>
          For questions about these Terms, reach us through the Settings section of the
          application.
        </LegalParagraph>
      </LegalSection>
    </div>
  );
}

function PrivacyDocument() {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[#e6edf3] mb-1">Privacy Policy</h3>
      <p className="text-[12px] text-[#8b949e] mb-4">
        Effective date: September 2026
      </p>

      <LegalSection title="Overview">
        <LegalParagraph>
          OrcaChat is designed with privacy as a core principle. This policy explains
          what little data the Service handles and how it is protected.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Data We Do Not Collect">
        <LegalParagraph>
          We do not collect, store, or have access to:
        </LegalParagraph>
        <ul className="space-y-1">
          <LegalListItem>Your conversations or chat history.</LegalListItem>
          <LegalListItem>Account credentials, email addresses, or phone numbers.</LegalListItem>
          <LegalListItem>Browsing behavior, device fingerprints, or analytics profiles.</LegalListItem>
        </ul>
      </LegalSection>

      <LegalSection title="Data Stored Locally on Your Device">
        <LegalParagraph>
          All chat data, settings, and preferences are stored exclusively in your
          browser&apos;s local storage (IndexedDB) and are encrypted at rest. This data
          never leaves your device unless you explicitly export it.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Data Processed by Third-Party Providers">
        <LegalParagraph>
          When you send a message, your prompt is forwarded to the AI model provider
          you have selected (e.g., OpenAI, Anthropic, Google). These providers process
          your input to generate a response. We do not control how these providers
          handle data after processing. Review each provider&apos;s privacy policy for
          details.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Server-Side Data">
        <LegalParagraph>
          The Service may temporarily process request metadata (e.g., rate-limit
          identifiers, timestamps) in memory to operate the API. This data is
          ephemeral, not persisted, and is discarded after the request completes.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Cookies & Tracking">
        <LegalParagraph>
          OrcaChat does not use tracking cookies, analytics scripts, or advertising
          technologies. No third-party cookies are set by the Service.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Data Retention & Deletion">
        <LegalParagraph>
          All data persists on your device until you delete it. You can clear all
          history at any time from Settings → Clear History. This action is immediate
          and irreversible.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Your Rights">
        <LegalParagraph>
          Depending on your jurisdiction, you may have rights under data protection
          laws such as the GDPR (EU/EEA) or CCPA/CPRA (California). Because we do
          not collect or store your personal data, these rights are exercised directly
          through the app:
        </LegalParagraph>
        <ul className="space-y-1">
          <LegalListItem>
            <strong className="text-[#c9d1d9]">Access & Portability</strong> — export your data at any time from Settings.
          </LegalListItem>
          <LegalListItem>
            <strong className="text-[#c9d1d9]">Erasure</strong> — delete all data instantly from Settings → Clear History.
          </LegalListItem>
          <LegalListItem>
            <strong className="text-[#c9d1d9]">Rectification</strong> — edit your profile name directly in Settings.
          </LegalListItem>
        </ul>
      </LegalSection>

      <LegalSection title="Children&apos;s Privacy">
        <LegalParagraph>
          OrcaChat is not directed to individuals under the age of 13 (or the
          applicable age of digital consent in your jurisdiction). We do not knowingly
          collect data from children.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Changes to This Policy">
        <LegalParagraph>
          We may update this Privacy Policy periodically. Material changes will be
          reflected in the Service. Your continued use after changes take effect
          constitutes acceptance.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Contact">
        <LegalParagraph>
          For privacy-related inquiries, reach us through the Settings section of the
          application.
        </LegalParagraph>
      </LegalSection>
    </div>
  );
}


/* =========================================
   PROFILE FIELD
========================================= */
