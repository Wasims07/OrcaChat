"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import MainChat from "@/components/Chat/MainChat";
import PrivacyNotice from "@/components/Settings/PrivacyNotice";
import { deleteChatSession } from "@/lib/chatStorage";

// Lazy-load the sidebar (its children — chat history, models manager, settings —
// are large and only needed once the user interacts with it).
const Sidebar = dynamic(() => import("@/components/Sidebar/Sidebar"), {
  ssr: false,
  loading: () => <div className="h-full w-[260px] shrink-0 animate-pulse bg-[#161b22]" />,
});

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // Increments on every "New Chat" click. Even when the user is already on an
  // internally-created chat (where selectedChatId is null and unchanged), this
  // forces MainChat to reset to a brand-new empty conversation.
  const [newChatNonce, setNewChatNonce] = useState(0);

  // Start with the sidebar docked on desktop, drawer-closed on mobile.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) {
      const t = setTimeout(() => setSidebarOpen(true), 0);
      return () => clearTimeout(t);
    }
  }, []);

  const handleNewChat = () => {
    setSelectedChatId(null);
    setActiveChatId(null);
    setNewChatNonce((n) => n + 1);
  };

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setActiveChatId(chatId);
  };

  const handleDeleteChat = (chatId: string) => {
    void deleteChatSession(chatId).then(() => {
      if (selectedChatId === chatId) {
        setSelectedChatId(null);
        setActiveChatId(null);
      }
    });
  };

  // Open Settings directly into the Privacy Policy view (used by the
  // first-use Privacy Notice), re-opening the sidebar if it was closed.
  const openPrivacySettings = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("orcachat-open-settings", { detail: { view: "privacy" } })
    );
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0d1117] h-dvh">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onRequestOpen={() => setSidebarOpen(true)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        activeChatId={activeChatId}
      />
      <MainChat
        key={newChatNonce}
        sidebarOpen={sidebarOpen}
        onOpenSidebar={() => setSidebarOpen(true)}
        onChatIdChange={setActiveChatId}
        chatId={selectedChatId}
      />
      <PrivacyNotice onOpenPrivacy={openPrivacySettings} />
    </div>
  );
}