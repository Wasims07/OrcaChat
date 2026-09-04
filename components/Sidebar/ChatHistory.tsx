"use client";

import { useState, useEffect, useRef } from "react";
import {
  MoreHorizontal,
  Clock,
  History,
  Pin,
  MessageSquare,
} from "lucide-react";

import ChatMenu from "@/components/Sidebar/ChatMenu";
import { getChatSessions, ensureChatsLoaded, ChatSession } from "@/lib/chatStorage";

type ChatHistoryProps = {
  onSelectChat?: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
  onChatUpdate?: () => void;
  activeChatId?: string | null;
};

export default function ChatHistory({
  onSelectChat,
  onDeleteChat,
  onChatUpdate,
  activeChatId,
}: ChatHistoryProps) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openUpward, setOpenUpward] = useState(false);
  const menuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const loadChats = async () => {
    await ensureChatsLoaded();
    const sessions = getChatSessions();
    const activeChats = sessions.filter(s => !s.isArchived);
    activeChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    setChats(activeChats);
  };

  useEffect(() => {
    // Load chats on mount (async; state updates only after hydration).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChats();
    // Reload on cross-tab storage changes AND same-tab chat updates
    const reload = () => loadChats();
    window.addEventListener("storage", reload);
    window.addEventListener("chat-updated", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("chat-updated", reload);
    };
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenu) {
        const menuElement = menuRefs.current[openMenu];
        if (menuElement && !menuElement.contains(e.target as Node)) {
          setOpenMenu(null);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenu]);

  const toggleMenu = (id: string) => {
    setOpenMenu((current) => {
      if (current === id) return null;
      // Decide whether to open the menu upward: the menu (about 180px tall,
      // including its 32px offset) must fit below the 3-dot button.
      const buttonEl = menuRefs.current[id];
      let upward = false;
      if (buttonEl) {
        const rect = buttonEl.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        upward = spaceBelow < 180 && spaceAbove >= 180;
      }
      setOpenUpward(upward);
      return id;
    });
  };

  const handleChatUpdate = () => {
    loadChats();
    if (onChatUpdate) onChatUpdate();
  };

  const getTimeDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfItem = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    // Today: keep compact, relative times.
    if (startOfItem.getTime() === startOfToday.getTime()) {
      const diff = now.getTime() - date.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (hours === 0 && minutes === 0) return "Just now";
      if (hours === 0) return `${minutes}m`;
      return `${hours}h`;
    }

    // Older: show a compact date like "Sep 2". Add the year only for items
    // from previous years (e.g. "Dec 15, 2025"), so the current year stays clean.
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const month = date.toLocaleDateString("en-US", { month: "short" });
    if (startOfItem.getTime() < startOfYear.getTime()) {
      return `${month} ${date.getDate()}, ${date.getFullYear()}`;
    }
    return `${month} ${date.getDate()}`;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pinnedChats = chats.filter(c => c.isPinned === true);
  const todayChats = chats.filter(c => {
    if (c.isPinned) return false;
    const date = new Date(c.updatedAt);
    return date >= today;
  });
  const historyChats = chats.filter(c => {
    if (c.isPinned) return false;
    const date = new Date(c.updatedAt);
    return date < today;
  });

  return (
    <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">

      {chats.length > 0 && (
        <div className="flex h-[30px] items-center justify-between px-2 pb-1">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8b949e]">
            <MessageSquare size={12} strokeWidth={2} className="text-[#8b949e]" />
            Chats
          </span>
          <span className="rounded-md border border-[#30363d] bg-[#21262d] px-1.5 py-0.5 text-[10px] font-medium text-[#8b949e]">
            {chats.length}
          </span>
        </div>
      )}

      {pinnedChats.length > 0 && (
        <>
          <SectionTitle icon={<Pin size={12} />} title="Pinned" />
          <div className="space-y-0.5">
            {pinnedChats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                active={activeChatId === chat.id}
                menuOpen={openMenu === chat.id}
                onMenuClick={() => toggleMenu(chat.id)}
                openUpward={openUpward}
                getTimeDisplay={getTimeDisplay}
                onSelect={onSelectChat}
                onDeleteChat={onDeleteChat}
                onChatUpdate={handleChatUpdate}
                menuRef={(el) => { menuRefs.current[chat.id] = el; }}
              />
            ))}
          </div>
        </>
      )}

      {todayChats.length > 0 && (
        <>
          <SectionTitle icon={<Clock size={12} />} title="Today" marginTop />
          <div className="space-y-0.5">
            {todayChats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                active={activeChatId === chat.id}
                menuOpen={openMenu === chat.id}
                onMenuClick={() => toggleMenu(chat.id)}
                openUpward={openUpward}
                getTimeDisplay={getTimeDisplay}
                onSelect={onSelectChat}
                onDeleteChat={onDeleteChat}
                onChatUpdate={handleChatUpdate}
                menuRef={(el) => { menuRefs.current[chat.id] = el; }}
              />
            ))}
          </div>
        </>
      )}

      {historyChats.length > 0 && (
        <>
          <SectionTitle icon={<History size={12} />} title="Chat History" marginTop />
          <div className="space-y-0.5">
            {historyChats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                active={activeChatId === chat.id}
                menuOpen={openMenu === chat.id}
                onMenuClick={() => toggleMenu(chat.id)}
                openUpward={openUpward}
                getTimeDisplay={getTimeDisplay}
                onSelect={onSelectChat}
                onDeleteChat={onDeleteChat}
                onChatUpdate={handleChatUpdate}
                menuRef={(el) => { menuRefs.current[chat.id] = el; }}
              />
            ))}
          </div>
        </>
      )}

      {chats.length === 0 && (
        <div className="flex flex-col items-center justify-center h-[200px] text-center">
          <p className="text-[#8b949e] text-sm">No chats yet</p>
          <p className="text-[#8b949e] text-xs mt-1">Start a new conversation</p>
        </div>
      )}

    </div>
  );
}

/* =========================================
   SECTION TITLE
========================================= */

function SectionTitle({
  icon,
  title,
  marginTop = false,
}: {
  icon: React.ReactNode;
  title: string;
  marginTop?: boolean;
}) {
  return (
    <div
      className={`
        flex
        h-[30px]
        items-center
        gap-2
        px-2
        pb-1.5
        ${marginTop ? "mt-3" : ""}
      `}
    >
      <span className="text-[#8b949e]">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8b949e]">
        {title}
      </span>
    </div>
  );
}

/* =========================================
   CHAT ITEM
========================================= */

function ChatItem({
  chat,
  active = false,
  menuOpen,
  onMenuClick,
  openUpward,
  getTimeDisplay,
  onSelect,
  onDeleteChat,
  onChatUpdate,
  menuRef,
}: {
  chat: ChatSession;
  active?: boolean;
  menuOpen: boolean;
  onMenuClick: () => void;
  openUpward: boolean;
  getTimeDisplay: (date: string) => string;
  onSelect?: (id: string) => void;
  onDeleteChat?: (chatId: string) => void;
  onChatUpdate: () => void;
  menuRef: (el: HTMLDivElement | null) => void;
}) {
  const highlighted = active || menuOpen;

  return (
    <div ref={menuRef} className="group relative">

      <button
        onClick={() => onSelect && onSelect(chat.id)}
        className={`
          group/chat
          relative
          flex
          w-full
          min-w-0
          items-center
          gap-2
          rounded-md
          px-2.5
          py-1.5
          text-left
          transition-all
          duration-150

          ${highlighted
            ? "bg-[#21262d] text-[#c9d1d9]"
            : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9]"
          }
        `}
      >

        {active && (
          <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full bg-[#8C8C8C]" />
        )}

        {chat.isPinned ? (
          <Pin size={12} className="shrink-0 text-[#8b949e]" />
        ) : (
          <span className="shrink-0 text-[#6e7681] transition-colors group-hover/chat:text-[#8b949e]">
            <MessageSquare size={12} strokeWidth={1.8} />
          </span>
        )}

        <span className="flex min-w-0 flex-1 items-center pr-6">
          <span className={`truncate text-[14px] leading-5 ${active ? "font-medium" : "font-normal"}`}>
            {chat.title || "New Chat"}
          </span>
        </span>

        <span className="shrink-0 text-[10px] text-[#8b949e] font-light">
          {getTimeDisplay(chat.updatedAt)}
        </span>

      </button>

      <button
        onClick={(event) => {
          event.stopPropagation();
          onMenuClick();
        }}
        className={`
          absolute
          right-1.5
          top-1/2
          flex
          h-6
          w-6
          -translate-y-1/2
          items-center
          justify-center
          rounded-md
          transition-all

          ${highlighted
            ? "bg-[#1f6feb]/15 text-[#58a6ff]"
            : "text-[#8b949e] opacity-0 group-hover:opacity-100 hover:bg-[#1c2128] hover:text-[#c9d1d9]"
          }
        `}
        title="Chat options"
      >
        <MoreHorizontal size={14} strokeWidth={2} />
      </button>

      {menuOpen && (
        <div>
          <ChatMenu
            chatId={chat.id}
            chatTitle={chat.title}
            isPinned={chat.isPinned}
            isArchived={chat.isArchived}
            openUpward={openUpward}
            onMenuClose={onMenuClick}
            onChatUpdate={onChatUpdate}
            onDeleteChat={onDeleteChat}
          />
        </div>
      )}

    </div>
  );
}