"use client";

import { useState } from "react";
import {
  Pencil,
  Pin,
  Archive,
  Trash2,
  Check,
  X,
} from "lucide-react";

import {
  updateChatTitle,
  togglePinChat,
  toggleArchiveChat,
  deleteChatSession,
} from "@/lib/chatStorage";
import ConfirmDialog from "@/components/UI/ConfirmDialog";

type ChatMenuProps = {
  chatId: string;
  chatTitle: string;
  isPinned?: boolean;
  isArchived?: boolean;
  openUpward?: boolean;
  onMenuClose: () => void;
  onChatUpdate: () => void;
  onDeleteChat?: (chatId: string) => void;
};

export default function ChatMenu({
  chatId,
  chatTitle,
  isPinned = false,
  isArchived = false,
  openUpward = false,
  onMenuClose,
  onChatUpdate,
  onDeleteChat,
}: ChatMenuProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(chatTitle);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleRename = () => {
    if (newTitle.trim()) {
      updateChatTitle(chatId, newTitle.trim());
      onChatUpdate();
      setIsRenaming(false);
      onMenuClose();
    }
  };

  const handlePin = () => {
    togglePinChat(chatId);
    onChatUpdate();
    onMenuClose();
  };

  const handleArchive = () => {
    toggleArchiveChat(chatId);
    onChatUpdate();
    onMenuClose();
  };

  const handleDelete = () => {
    if (onDeleteChat) {
      // Let the parent clear the main view + remove from storage in one step.
      onDeleteChat(chatId);
    } else {
      deleteChatSession(chatId);
    }
    onChatUpdate();
    onMenuClose();
    setShowDeleteConfirm(false);
  };

  if (isRenaming) {
    return (
      <div
        className={`
          absolute
          right-0
          z-[100]
          w-[200px]
          overflow-hidden
          rounded-md
          border
          border-[#30363d]
          bg-[#161b22]
          p-2
          shadow-[0_24px_60px_rgba(0,0,0,0.6)]
          backdrop-blur-sm

          ${openUpward ? "bottom-[32px]" : "top-[32px]"}
        `}
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            className="
              flex-1
              rounded-md
              border
              border-[#30363d]
              bg-[#0d1117]
              px-2.5
              py-1.5
              text-[13px]
              text-[#c9d1d9]
              outline-none
              focus:border-[#1f6feb]
            "
            autoFocus
          />
          <button
            onClick={handleRename}
            className="rounded-md bg-[#238636] p-1.5 text-white hover:bg-[#2ea043]"
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => setIsRenaming(false)}
            className="rounded-md bg-[#21262d] p-1.5 text-[#8b949e] hover:bg-[#30363d] hover:text-[#c9d1d9]"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`
          absolute
          right-0
          z-[100]
          w-[160px]
          overflow-hidden
          rounded-md
          border
          border-[#30363d]
          bg-[#161b22]
          p-1.5
          shadow-[0_24px_60px_rgba(0,0,0,0.6)]
          backdrop-blur-sm

          ${openUpward ? "bottom-[32px]" : "top-[32px]"}
        `}
      >
        <MenuItem
          icon={<Pencil size={14} strokeWidth={1.7} />}
          title="Rename"
          onClick={() => setIsRenaming(true)}
        />

        <MenuItem
          icon={<Pin size={14} strokeWidth={1.7} />}
          title={isPinned ? "Unpin" : "Pin chat"}
          onClick={handlePin}
        />

        <MenuItem
          icon={<Archive size={14} strokeWidth={1.7} />}
          title={isArchived ? "Unarchive" : "Archive"}
          onClick={handleArchive}
        />

        <div className="my-1 border-t border-[#21262d]" />

        <MenuItem
          icon={<Trash2 size={14} strokeWidth={1.7} />}
          title="Delete"
          danger
          onClick={() => setShowDeleteConfirm(true)}
        />
      </div>

      {/* Delete Confirmation Dialog - positioned near sidebar */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Chat"
        message={`Are you sure you want to delete "${chatTitle}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        danger
      />
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
        h-[32px]
        w-full
        items-center
        gap-2.5
        rounded-md
        px-2.5
        text-left
        text-[13px]
        font-normal
        transition-all

        ${danger
          ? "text-[#f85149] hover:bg-[#f85149]/10"
          : "text-[#8b949e] hover:bg-[#1c2128] hover:text-[#c9d1d9]"
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