"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
};

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:justify-start md:pl-[300px]"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-md border border-[#30363d] bg-[#161b22] p-6 shadow-2xl animate-in slide-in-from-left-4 duration-200 md:ml-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[17px] font-semibold text-[#e6edf3]">{title}</h3>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9] transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message */}
        <p className="text-[14px] text-[#8b949e] leading-relaxed">{message}</p>

        {/* Buttons */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-md border border-[#30363d] bg-[#21262d] px-4 py-2.5 text-[14px] font-medium text-[#8b949e] transition hover:bg-[#30363d] hover:text-[#c9d1d9]"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-md px-4 py-2.5 text-[14px] font-medium text-white transition ${
              danger
                ? "bg-[#da3633] hover:bg-[#f85149]"
                : "bg-[#1f6feb] hover:bg-[#388bfd]"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}