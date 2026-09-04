"use client";

import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";

import {
  Plus,
  Mic,
  ArrowUp,
  ArrowDown,
  Paperclip,
  Globe,
  Maximize2,
  Minimize2,
  FileText,
  X,
  File,
  Image as ImageIcon,
  Loader2,
  Upload,
  Languages,
} from "lucide-react";

import { detectLanguage, speechLangTag } from "@/lib/detectLanguage";

// Speech input language options. The top entry (auto) detects the language from
// text already typed, or falls back to the browser's UI language.
const SPEECH_LANGUAGES = [
  "Auto",
  "Arabic",
  "Bengali",
  "Chinese",
  "English",
  "French",
  "German",
  "Hindi",
  "Irish",
  "Italian",
  "Japanese",
  "Korean",
  "Malayalam",
  "Portuguese",
  "Russian",
  "Spanish",
  "Tamil",
  "Thai",
  "Turkish",
  "Vietnamese",
] as const;

// Minimal structural types for the Web Speech API (not in the DOM lib).
type SpeechRecognitionEventLike = {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionError = { error?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionError) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition || w.webkitSpeechRecognition || w.mozSpeechRecognition;
  return (typeof ctor === "function" ? ctor : undefined) as
    | SpeechRecognitionCtor
    | undefined;
}

type ChatInputProps = {
  onSend: (message: string, files?: File[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  onFilePreview?: (file: File) => void;  // ✅ Added
  onFileRemove?: (file: File) => void;  // ✅ Notify when a pending file is removed
  onWebSearchChange?: (enabled: boolean) => void;  // ✅ Sync web search toggle
  needsScrollArrow?: boolean;
  onScrollToBottom?: () => void;
  freeLimitReached?: boolean;
  onAddKey?: () => void;
  onTakeGuide?: () => void;
};

// File type icons
const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  
  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext || '')) {
    return <ImageIcon size={16} className="text-blue-400" />;
  }
  
  // PDF
  if (['pdf'].includes(ext || '')) {
    return <FileText size={16} className="text-red-400" />;
  }
  
  // Word documents
  if (['doc', 'docx'].includes(ext || '')) {
    return <FileText size={16} className="text-blue-500" />;
  }
  
  // Excel
  if (['xls', 'xlsx', 'csv'].includes(ext || '')) {
    return <FileText size={16} className="text-green-500" />;
  }
  
  // Code files
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'html', 'css', 'json', 'xml'].includes(ext || '')) {
    return <FileText size={16} className="text-yellow-500" />;
  }
  
  // Text files
  if (['txt', 'md', 'rtf'].includes(ext || '')) {
    return <FileText size={16} className="text-gray-400" />;
  }
  
  // Default
  return <File size={16} className="text-gray-400" />;
};

// Format file size
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// =========================================
// File Preview Modal Component
// =========================================
function FilePreviewModal({
  file,
  onClose,
  isOpen,
}: {
  file: File | null;
  onClose: () => void;
  isOpen: boolean;
}) {
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset of
     the loading/content state whenever a new file is opened; the actual load
     completes asynchronously via the FileReader callbacks below. */
  useEffect(() => {
    if (file && isOpen) {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === "string") {
          const preview = result.length > 5000 
            ? result.substring(0, 5000) + "\n\n... (preview truncated)" 
            : result;
          setContent(preview);
        } else {
          setContent("📷 Image file (preview not available)");
        }
        setIsLoading(false);
      };
      reader.onerror = () => {
        setContent("❌ Error reading file");
        setIsLoading(false);
      };
      
      if (file.type.startsWith("image/")) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    }
  }, [file, isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen || !file) return null;

  const isImage = file.type.startsWith("image/");

  return (
    <div
      className="
        fixed inset-0 z-50 flex items-center justify-center
        bg-black/70 backdrop-blur-sm
        animate-in fade-in duration-200
      "
      onClick={onClose}
    >
      <div
        className="
          relative max-w-3xl w-full max-h-[90vh] mx-4
          bg-[#161b22] border border-[#30363d]
          rounded-md shadow-2xl
          overflow-hidden
          animate-in zoom-in-95 duration-200
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-md bg-[#21262d] flex items-center justify-center flex-shrink-0">
              {isImage ? (
                <ImageIcon size={18} className="text-[#58a6ff]" />
              ) : (
                <FileText size={18} className="text-[#8b949e]" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-[#c9d1d9] truncate">
                {file.name}
              </h3>
              <p className="text-xs text-[#8b949e]">
                {(file.size / 1024).toFixed(1)} KB • {file.type || "Unknown"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="
              p-1.5 rounded-md
              text-[#8b949e] hover:text-[#c9d1d9]
              hover:bg-[#21262d]
              transition
            "
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {/* eslint-disable @next/next/no-img-element -- image previews are rendered from local data URLs, not next/image */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[#1f6feb]" />
              <span className="ml-3 text-[#8b949e]">Loading preview...</span>
            </div>
          ) : isImage && content.startsWith('data:image') ? (
            <img
              src={content}
              alt={file.name}
              className="max-w-full max-h-[60vh] object-contain rounded-md"
            />
          ) : (
            <div className="
              bg-[#161b22] rounded-md p-4
              font-mono text-xs text-[#c9d1d9]
              whitespace-pre-wrap break-words
              max-h-[60vh] overflow-y-auto
              border border-[#30363d]
            ">
              {content || "No content to preview"}
            </div>
          )}
          {/* eslint-enable @next/next/no-img-element */}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#30363d] bg-[#161b22]">
          <p className="text-xs text-[#8b949e]">
            {isImage ? "🖼️ Image preview" : "📄 Text preview (first 5000 characters)"}
          </p>
        </div>
      </div>
    </div>
  );
}

const ChatInput = forwardRef<{ setInput: (value: string) => void }, ChatInputProps>(
  ({ onSend, onStop, isLoading = false, onFilePreview, onFileRemove, onWebSearchChange, needsScrollArrow = false, onScrollToBottom, freeLimitReached = false, onAddKey, onTakeGuide }, ref) => {
    const [plusMenuOpen, setPlusMenuOpen] = useState(false);
    const [plusMenuClosing, setPlusMenuClosing] = useState(false);
    const [message, setMessage] = useState("");
    const [webSearch, setWebSearch] = useState<boolean>(() => {
      if (typeof window === "undefined") return true;
      try {
        const stored = localStorage.getItem("orcachat_web_search");
        return stored !== "0";
      } catch {
        return true;
      }
    });
    const [composerWidth, setComposerWidth] = useState<number | null>(() => {
      if (typeof window === "undefined") return null;
      try {
        const stored = localStorage.getItem("orcachat_composer_width");
        const w = stored ? parseInt(stored, 10) : NaN;
        return !Number.isNaN(w) ? w : null;
      } catch {
        return null;
      }
    });
    const [resizing, setResizing] = useState(false);
    const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const [isReadingFiles, setIsReadingFiles] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [previewFile, setPreviewFile] = useState<File | null>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [queued, setQueued] = useState<{ text: string; files: File[] } | null>(null);
    const [speechLang, setSpeechLang] = useState<string>(() => {
      if (typeof window === "undefined") return "Auto";
      try {
        return localStorage.getItem("orcachat_speech_lang") || "Auto";
      } catch {
        return "Auto";
      }
    });
    const [voiceLangOpen, setVoiceLangOpen] = useState(false);
    const [flipToRight, setFlipToRight] = useState(false);

    const menuRef = useRef<HTMLDivElement>(null);
    const plusBtnRef = useRef<HTMLButtonElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const speechStoppedRef = useRef(false);
    const closePlusMenuRef = useRef<() => void>(() => {});

    useImperativeHandle(ref, () => ({
      setInput: (value: string) => {
        setMessage(value);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 0);
      },
    }));

    useEffect(() => {
      function handleOutsideClick(event: MouseEvent) {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          closePlusMenuRef.current();
        }
      }

      if (plusMenuOpen) {
        document.addEventListener("mousedown", handleOutsideClick);
      }

      return () => {
        document.removeEventListener("mousedown", handleOutsideClick);
      };
    }, [plusMenuOpen]);



    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      const maxHeight = 240;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }, [message]);

    useEffect(() => {
      if (!unavailableMessage) return;
      const timer = setTimeout(() => setUnavailableMessage(null), 2200);
      return () => clearTimeout(timer);
    }, [unavailableMessage]);

    // Persist the web search preference (client-only).
    useEffect(() => {
      try {
        localStorage.setItem("orcachat_web_search", webSearch ? "1" : "0");
      } catch {}
    }, [webSearch]);

    // Persist the speech input language.
    useEffect(() => {
      try {
        localStorage.setItem("orcachat_speech_lang", speechLang);
      } catch {}
    }, [speechLang]);

    // ✅ Sync web search state to parent (initial + on every toggle)
    useEffect(() => {
      onWebSearchChange?.(webSearch);
    }, [webSearch, onWebSearchChange]);

    function sendMessage() {
      // ✅ Stop voice dictation when sending (and block late speech results)
      if (isListening) {
        speechStoppedRef.current = true;
        try {
          recognitionRef.current?.stop();
        } catch {}
        setIsListening(false);
      }

      const text = message.trim();
      if (!text && attachedFiles.length === 0) return;

      // ✅ While a reply is still generating, hold the draft in the box and
      // auto-send it as soon as the current response finishes.
      if (isLoading) {
        setQueued({ text, files: [...attachedFiles] });
        return;
      }

      onSend(text, attachedFiles);
      setMessage("");
      setAttachedFiles([]);
      setImagePreviews([]);
    }

    // ✅ Auto-send a queued draft the moment the current reply completes.
    useEffect(() => {
      if (isLoading || !queued) return;
      const draft = queued;
      if (!draft.text.trim() && draft.files.length === 0) return;

      // Flush on the next tick so the queued state can be committed cleanly.
      const timer = setTimeout(() => {
        setQueued(null);
        setMessage("");
        setAttachedFiles([]);
        setImagePreviews([]);
        onSend(draft.text, draft.files);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }, 0);

      return () => clearTimeout(timer);
    }, [isLoading, queued, onSend]);

    // ✅ Speech-to-text (Web Speech API - Chrome/Edge/Safari)
    function toggleSpeech() {
      if (typeof window === "undefined") return;

      // Stop if already listening
      if (isListening) {
        recognitionRef.current?.stop();
        speechStoppedRef.current = true;
        setIsListening(false);
        return;
      }

      const SpeechRecognitionCtor = getSpeechRecognitionCtor();

      if (!SpeechRecognitionCtor) {
        setUnavailableMessage("Voice input isn't supported here (try Chrome or Edge)");
        return;
      }

      try {
        const recognition = new SpeechRecognitionCtor();
        const initial = message.trim(); // text typed before dictation starts
        let final = "";

        // ✅ Choose the speech language: explicit picker beats auto. In "Auto",
        // detect from text already typed, else fall back to the browser's UI
        // language so non-English speakers get transcription without setup.
        let langTag = "en-US";
        if (speechLang !== "Auto") {
          langTag =
            speechLangTag(speechLang) ||
            (typeof navigator !== "undefined" ? navigator.language : "en-US");
        } else {
          const detected = detectLanguage(initial);
          langTag =
            speechLangTag(detected || "") ||
            (typeof navigator !== "undefined"
              ? navigator.language || "en-US"
              : "en-US");
        }

        recognition.lang = langTag;
        recognition.continuous = true;
        recognition.interimResults = true;

        speechStoppedRef.current = false;

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          // ✅ Ignore results arriving after the user already sent/stopped
          if (speechStoppedRef.current) return;
          final = "";
          for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            }
          }
          const interim = Array.from(event.results)
            .filter((r) => !r.isFinal)
            .map((r) => r[0].transcript)
            .join("");
          const spoken = `${final}${interim}`.trim();
          setMessage([initial, spoken].filter(Boolean).join(" "));
        };

        recognition.onerror = (event: SpeechRecognitionError) => {
          console.error("Speech error:", event.error);
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setUnavailableMessage(
              typeof window !== "undefined" && !window.isSecureContext
                ? "Microphone is blocked because this page isn't running on https:// or localhost. Open the app on localhost to use voice input."
                : "Microphone permission denied. Allow mic access in the address bar and try again."
            );
          }
          setIsListening(false);
        };

        recognition.onend = () => setIsListening(false);

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
        textareaRef.current?.focus();
      } catch (error) {
        console.error("Failed to start speech recognition:", error);
        setIsListening(false);
      }
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    }

    function handleMessageChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
      const value = event.target.value;
      setMessage(value);
    }

    function openFileExplorer() {
      fileInputRef.current?.click();
      closePlusMenu();
    }

    function removeFile(index: number) {
      const removed = attachedFiles[index];
      if (removed && onFileRemove) onFileRemove(removed);
      // If this was the previewed file, close the preview too.
      if (removed && previewFile === removed) {
        setPreviewFile(null);
        setIsPreviewOpen(false);
      }
      setAttachedFiles(prev => prev.filter((_, i) => i !== index));
      setImagePreviews(prev => prev.filter((_, i) => i !== index));
    }

    function handleFileClick(file: File) {
      console.log("📄 File clicked:", file.name);
      if (onFilePreview) {
        onFilePreview(file);
      } else {
        setPreviewFile(file);
        setIsPreviewOpen(true);
      }
    }

    function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const newFiles = Array.from(files);
      
      const maxSize = 100 * 1024 * 1024;
      const oversizedFiles = newFiles.filter(file => file.size > maxSize);
      
      if (oversizedFiles.length > 0) {
        const names = oversizedFiles.map(f => f.name).join(', ');
        setUnavailableMessage(`⚠️ ${names} exceeds 100MB limit`);
        event.target.value = "";
        return;
      }

      setIsReadingFiles(true);

      const previews: string[] = [];
      newFiles.forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            previews.push(e.target?.result as string);
            if (previews.length === newFiles.filter(f => f.type.startsWith('image/')).length) {
              setImagePreviews(prev => [...prev, ...previews]);
            }
          };
          reader.readAsDataURL(file);
        }
      });

      setTimeout(() => {
        setAttachedFiles(prev => [...prev, ...newFiles]);
        setIsReadingFiles(false);
        
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }, 300);

      event.target.value = "";
    }

    // =========================================
    // Drag and Drop Handlers
    // =========================================
    function handleDragEnter(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    }

    function handleDragLeave(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    }

    function handleDragOver(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (!isDragging) setIsDragging(true);
    }

    function handleDrop(e: React.DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      const newFiles = Array.from(files);
      
      const maxSize = 100 * 1024 * 1024;
      const oversizedFiles = newFiles.filter(file => file.size > maxSize);
      
      if (oversizedFiles.length > 0) {
        const names = oversizedFiles.map(f => f.name).join(', ');
        setUnavailableMessage(`⚠️ ${names} exceeds 100MB limit`);
        return;
      }

      setIsReadingFiles(true);

      const previews: string[] = [];
      newFiles.forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            previews.push(e.target?.result as string);
            if (previews.length === newFiles.filter(f => f.type.startsWith('image/')).length) {
              setImagePreviews(prev => [...prev, ...previews]);
            }
          };
          reader.readAsDataURL(file);
        }
      });

      setTimeout(() => {
        setAttachedFiles(prev => [...prev, ...newFiles]);
        setIsReadingFiles(false);
        
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }, 300);
    }

    function closePlusMenu() {
      if (!plusMenuOpen || plusMenuClosing) return;
      setPlusMenuClosing(true);
      setTimeout(() => {
        setPlusMenuOpen(false);
        setPlusMenuClosing(false);
      }, 150);
    }

    // Keep a fresh reference for the outside-click listener registered in the
    // effect above, so the listener doesn't need to be re-created each render.
    useEffect(() => {
      closePlusMenuRef.current = closePlusMenu;
    });

    function togglePlusMenu() {
      if (plusMenuOpen) {
        closePlusMenu();
      } else {
        measureOpenSide();
        setPlusMenuOpen(true);
      }
    }

    // Opens the "+" menu to the LEFT (above, right edge aligned to the icon).
    // When the menu's left edge would reach/overlap the docked sidebar, it
    // flips to the RIGHT side of the icon so it never clips under the sidebar.
    // The sidebar width is read live from the DOM; re-measured on mount, resize,
    // scroll, and whenever the box resizes (sidebar/preview change its width via
    // CSS, not window resize, so a ResizeObserver is required).
    useEffect(() => {
      if (typeof window === "undefined") return;
      const update = () => measureOpenSide();
      update();
      const ro = menuRef.current ? new ResizeObserver(update) : null;
      ro?.observe(menuRef.current as Element);
      window.addEventListener("resize", update);
      window.addEventListener("scroll", update, true);
      return () => {
        ro?.disconnect();
        window.removeEventListener("resize", update);
        window.removeEventListener("scroll", update, true);
      };
    }, []);

    function measureOpenSide() {
      const btn = plusBtnRef.current;
      if (!btn) return;
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setFlipToRight(false);
        return;
      }
      const sidebar = document.querySelector(".dc-sidebar");
      const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width : 0;
      const rect = btn.getBoundingClientRect();
      const menuWidth = 180;
      // btnRight is where the menu's right edge sits; its left would-be edge is
      // btnRight - menuWidth. Flip when that reaches the sidebar's right edge.
      const btnRight = rect.left + rect.width;
      setFlipToRight(btnRight - menuWidth <= sidebarWidth);
    }

    const useWide = (composerWidth ?? 768) > 1024;
    const resizeDragRef = useRef<{ startX: number; startW: number } | null>(
      null
    );

    function startResize(e: React.PointerEvent<HTMLDivElement>) {
      e.preventDefault();
      setResizing(true);
      resizeDragRef.current = {
        startX: e.clientX,
        startW: composerWidth ?? 768,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const delta = drag.startX - e.clientX;
      const max = Math.min(1200, (window.innerWidth || 0) - 48);
      const width = Math.min(max, Math.max(480, drag.startW + delta * 2));
      setComposerWidth(width);
    }

    function endResize() {
      const drag = resizeDragRef.current;
      if (!drag) return;
      resizeDragRef.current = null;
      setResizing(false);
      try {
        localStorage.setItem(
          "orcachat_composer_width",
          String(composerWidth ?? 768)
        );
      } catch {}
    }

    function handleSizeToggle() {
      const next = useWide ? 768 : 1080;
      setComposerWidth(next);
      try {
        localStorage.setItem("orcachat_composer_width", String(next));
      } catch {}
    }

    return (
      <>
        <div
          className={`
            absolute
            bottom-6
            left-1/2
            z-30
            w-full
            -translate-x-1/2
            px-3
            sm:px-0
            ${resizing ? "" : "transition-[max-width] duration-200"}
          `}
          style={{
            maxWidth: `min(${composerWidth ?? 768}px, 100%)`,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx"
            className="hidden"
            onChange={handleFiles}
          />

          <div ref={menuRef} className="relative">
            {unavailableMessage && (
              <div
                className="
                  absolute
                  bottom-[78px]
                  left-1/2
                  z-[70]
                  -translate-x-1/2
                  whitespace-nowrap
                  rounded-md
                  border
                  border-[#30363d]
                  bg-[#161b22]
                  px-3
                  py-2
                  text-[12px]
                  text-[#c9d1d9]
                  shadow-xl
                "
              >
                {unavailableMessage}
              </div>
            )}

            {/* Drag and Drop Overlay */}
            {isDragging && (
              <div
                className="
                  absolute inset-0 z-50
                  rounded-md
                  border-2 border-dashed border-[#1f6feb]
                  bg-[#1f6feb]/10
                  backdrop-blur-sm
                  flex items-center justify-center
                  pointer-events-none
                "
              >
                <div className="flex flex-col items-center gap-3">
                  <Upload size={40} className="text-[#58a6ff]" />
                  <p className="text-sm text-[#58a6ff] font-medium">
                    Drop your files here
                  </p>
                  <p className="text-xs text-[#8b949e]">
                    Max 1GB per file
                  </p>
                </div>
              </div>
            )}

            <div
              role="slider"
              aria-label="Resize chat box width"
              aria-valuemin={480}
              aria-valuemax={1200}
              aria-valuenow={composerWidth ?? 768}
              onPointerDown={startResize}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              className="absolute left-[-7px] top-1/2 z-40 hidden h-14 w-[14px] -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full transition hover:bg-white/[0.06] md:flex"
            >
              <span className="h-9 w-[3px] rounded-full bg-white/15 transition hover:bg-white/30" />
            </div>

{/* Free-limit notice — reached: sending is blocked in this chat */}
              {freeLimitReached && (
                <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-500/30 bg-[#1c1607] px-3 py-1.5 text-[11px] text-[#c9d1d9] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                  <span className="min-w-0 text-[#d4a017]">
                    You&apos;ve used your 10 free replies for this chat. Start a new chat for a fresh set.
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {onAddKey && (
                      <button
                        type="button"
                        onClick={onAddKey}
                        className="font-medium text-[#58a6ff] hover:underline"
                      >
                        Add your key
                      </button>
                    )}
                    {onTakeGuide && (
                      <button
                        type="button"
                        onClick={onTakeGuide}
                        className="font-medium text-[#c9d1d9] hover:underline"
                      >
                        Take the Guide
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
className="
                dc-chat-box
                rounded-2xl
                sm:rounded-md
                border
                border-[#30363d]
                bg-[#0d1117]
                px-3.5
                py-2.5
                shadow-[0_1px_3px_rgba(0,0,0,0.12)]
                transition
                focus-within:border-[#1f6feb]
                relative
              "
            >
              {/* Floating scroll-to-bottom arrow — centered above the box */}
              {needsScrollArrow && (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  className="
                    dc-scroll-arrow
                    absolute
                    -top-[18px]
                    left-1/2
                    z-30
                    -translate-x-1/2
                    flex
                    h-10
                    w-10
                    items-center
                    justify-center
                    rounded-full
                    border
                    border-[#30363d]
                    bg-[#161b22]/90
                    text-[#8b949e]
                    shadow-[0_8px_30px_rgba(0,0,0,0.55)]
                    backdrop-blur
                    ring-4
                    ring-[#0d1117]/50
                    transition-all
                    hover:scale-105
                    hover:border-[#484f58]
                    hover:bg-[#21262d]
                    hover:text-[#c9d1d9]
                  "
                  title="Scroll to latest"
                >
                  <ArrowDown size={18} />
                </button>
              )}

              {/* Queued draft indicator — sends when the current reply finishes */}
              {queued && (
                <div className="absolute -top-[56px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#30363d] bg-[#161b22]/95 px-3 py-1.5 text-[11px] font-medium text-[#c9d1d9] shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur">
                  <Loader2 size={12} className="animate-spin text-[#1f6feb]" />
                  Queued — sends when the current reply finishes
                </div>
              )}

              {/* Listening indicator */}
              {isListening && (
                <div className="absolute -top-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-[#f85149]/20 bg-[#161b22] px-2.5 py-1 shadow-lg animate-in fade-in zoom-in-95 duration-150">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#f85149] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#f85149]" />
                  </span>
                  <span className="text-[11px] text-[#ff7b72]">Listening…</span>
                </div>
              )}
              {/* File Attachments Preview with Thumbnails - Clickable */}
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 px-2 pb-2">
                  {attachedFiles.map((file, index) => {
                    const isImage = file.type.startsWith('image/');
                    const preview = imagePreviews[index];
                    const ext = file.name.split('.').pop()?.toLowerCase();
                    
                    // Get color for file type
                    const getFileColor = () => {
                      if (['pdf'].includes(ext || '')) return 'bg-red-500/20 border-red-500/30';
                      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return 'bg-blue-500/20 border-blue-500/30';
                      if (['doc', 'docx'].includes(ext || '')) return 'bg-blue-500/20 border-blue-500/30';
                      if (['xls', 'xlsx', 'csv'].includes(ext || '')) return 'bg-green-500/20 border-green-500/30';
                      if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'html', 'css', 'json'].includes(ext || '')) return 'bg-yellow-500/20 border-yellow-500/30';
                      return 'bg-gray-500/20 border-gray-500/30';
                    };
                    
                    // Get text color for file type
                    const getTextColor = () => {
                      if (['pdf'].includes(ext || '')) return 'text-red-400';
                      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return 'text-blue-400';
                      if (['doc', 'docx'].includes(ext || '')) return 'text-blue-500';
                      if (['xls', 'xlsx', 'csv'].includes(ext || '')) return 'text-green-500';
                      if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'html', 'css', 'json'].includes(ext || '')) return 'text-yellow-500';
                      return 'text-gray-400';
                    };
                    
                    return (
                      <div
                        key={index}
                        className={`
                          flex items-center gap-2
                          ${getFileColor()}
                          border rounded-md px-2 py-1.5
                          text-sm text-[#c9d1d9]
                          max-w-[220px]
                          group
                          relative
                          cursor-pointer
                          hover:border-[#6e7681]
                          hover:bg-opacity-30
                          transition-all
                        `}
                        onClick={() => handleFileClick(file)}
                      >
                        {/* File Icon with Color */}
                        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0">
                          {/* eslint-disable @next/next/no-img-element -- local thumbnail rendered from an object URL */}
                          {isImage && preview ? (
                            <img 
                              src={preview} 
                              alt={file.name}
                              className="w-full h-full object-cover rounded"
                            />
                          ) : (
                            <div className={getTextColor()}>
                              {getFileIcon(file.name)}
                            </div>
                          )}
                          {/* eslint-enable @next/next/no-img-element */}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <span className="truncate block text-xs">
                            {file.name}
                          </span>
                          <span className="text-[10px] text-[#8b949e]">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                          className="
                            ml-1 p-0.5 rounded
                            hover:bg-[#30363d]
                            transition
                            opacity-60 hover:opacity-100
                          "
                        >
                          <X size={14} className="text-[#8b949e]" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* File Upload Progress */}
              {isReadingFiles && (
                <div className="flex items-center gap-3 px-2 pb-2">
                  <div className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-[#1f6feb]" />
                    <span className="text-xs text-[#8b949e]">Processing files...</span>
                  </div>
                  <div className="flex-1 h-1 bg-[#21262d] rounded-full overflow-hidden">
                    <div className="h-full w-2/3 bg-[#1f6feb] rounded-full animate-pulse" />
                  </div>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={message}
                onChange={handleMessageChange}
                onKeyDown={handleKeyDown}
                placeholder={attachedFiles.length > 0 ? "Ask about the attached file..." : "Ask anything..."}
                rows={1}
                className="
                  block
                  w-full
                  resize-none
                  overflow-y-auto
                  bg-transparent
                  px-2
                  py-2
                  text-[15px]
                  leading-6
                  text-[#c9d1d9]
                  outline-none
                  placeholder:text-[#484f58]
                "
              />

              <div className="flex items-center">
                <div className="relative">
                  <button
                    type="button"
                    ref={plusBtnRef}
                    onClick={togglePlusMenu}
                    className={`
                      dc-text-btn
                      flex
                      h-9
                      w-9
                      items-center
                      justify-center
                      rounded-md
                      transition
                      ${
                        plusMenuOpen
                          ? "bg-[#1f6feb]/15 text-[#58a6ff]"
                          : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]"
                      }
                    `}
                    title="Add"
                  >
                    <Plus size={19} strokeWidth={1.7} />
                  </button>

                  {plusMenuOpen && (
                    <div
                      className={`
                        dc-plus-menu
                        absolute
                        bottom-full
                        mb-3
                        left-0 origin-bottom-left
                        ${
                          flipToRight
                            ? ""
                            : "md:left-auto md:right-0 md:origin-bottom-right"
                        }
                        z-50
                        flex
                        min-w-[180px]
                        flex-col
                        gap-0.5
                        rounded-md
                        border
                        border-[#30363d]
                        bg-[#161b22]/95
                        p-1.5
                        shadow-[0_20px_50px_rgba(0,0,0,0.7)]
                        ${
                          plusMenuClosing
                            ? "animate-out fade-out-0 zoom-out-95 duration-150 ease-in"
                            : "animate-in fade-in-0 zoom-in-95 duration-150 ease-out"
                        }
                      `}
                    >
                      <button
                        type="button"
                        onClick={openFileExplorer}
                        className="dc-plus-item flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition"
                        title="Add files or photos (Ctrl+U)"
                      >
                        <span className="text-[12.5px] font-medium">Add files</span>
                        <Paperclip size={15} className="dc-plus-icon shrink-0" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const next = !webSearch;
                          setWebSearch(next);
                        }}
                        className={`
                          dc-plus-item
                          relative
                          flex
                          w-full
                          items-center
                          justify-between
                          gap-2
                          rounded-md
                          px-3
                          py-2
                          text-left
                          transition
                          ${
                            webSearch
                              ? "bg-[#1f6feb]/15 text-[#58a6ff] hover:bg-[#1f6feb]/25 hover:text-[#79c0ff]"
                              : ""
                          }
                        `}
                        title={
                          webSearch
                            ? "Websites on - search the web in real time (click to turn off)"
                            : "Websites off - search the web in real time (click to turn on)"
                        }
                      >
                        <span className="text-[12.5px] font-medium">
                          Websites {webSearch ? "(on)" : "(off)"}
                        </span>
                        <Globe
                          size={15}
                          className={`dc-plus-icon shrink-0 ${webSearch ? "text-[#58a6ff]" : ""}`}
                        />
                        {webSearch && (
                          <span className="absolute right-8 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#58a6ff]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setVoiceLangOpen((o) => !o)}
                        className="dc-plus-item flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition"
                        title="Set language for voice input"
                      >
                        <span className="text-[12.5px] font-medium">
                          Voice language
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="dc-plus-icon text-[11px]">{speechLang}</span>
                          <Languages size={15} className="dc-plus-icon shrink-0" />
                        </span>
                      </button>
                      {voiceLangOpen && (
                        <div className="max-h-[160px] overflow-y-auto rounded-md border border-[#30363d] bg-[#21262d] p-1">
                          {SPEECH_LANGUAGES.map((lang) => (
                            <button
                              key={lang}
                              type="button"
                              onClick={() => {
                                setSpeechLang(lang);
                                setVoiceLangOpen(false);
                              }}
                              className={`dc-plus-item relative flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                                speechLang === lang
                                  ? "text-[#58a6ff]"
                                  : "text-[#c9d1d9]"
                              }`}
                            >
                              <span className="text-[12px]">{lang}</span>
                              {speechLang === lang && (
                                <span className="h-1.5 w-1.5 rounded-full bg-[#58a6ff]" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex-1" />

                <button
                  type="button"
                  onClick={handleSizeToggle}
                  className="
                    dc-text-btn
                    mr-1
                    hidden
                    h-9
                    w-9
                    items-center
                    justify-center
                    rounded-md
                    text-[#8b949e]
                    transition
                    hover:bg-[#21262d]
                    hover:text-[#c9d1d9]
                    md:flex
                  "
                  title={useWide ? "Collapse to compact width" : "Expand to full width"}
                >
                  {useWide ? (
                    <Minimize2 size={17} strokeWidth={1.7} />
                  ) : (
                    <Maximize2 size={17} strokeWidth={1.7} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={toggleSpeech}
                  className={`
                    dc-text-btn
                    mr-1
                    flex
                    h-9
                    w-9
                    items-center
                    justify-center
                    rounded-md
                    transition
                    ${
                      isListening
                        ? "bg-[#f85149]/15 text-[#f85149] hover:bg-[#f85149]/25 hover:text-[#ff7b72]"
                        : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]"
                    }
                  `}
                  title={isListening ? "Stop voice input" : "Voice input"}
                >
                  <Mic
                    size={18}
                    strokeWidth={1.7}
                    className={isListening ? "animate-pulse" : ""}
                  />
                </button>

                {isLoading ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="
                      flex
                      h-9
                      w-9
                      items-center
                      justify-center
                      rounded-full
                      bg-[#f85149]
                      text-white
                      transition
                      hover:bg-[#da3633]
                      animate-pulse
                    "
                    title="Stop generating"
                  >
                    <div className="h-3.5 w-3.5 bg-white rounded-sm" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={!message.trim() && attachedFiles.length === 0}
                    className={`
                      dc-send-btn
                      flex
                      h-9
                      w-9
                      items-center
                      justify-center
                      rounded-full
                      transition

                      ${
                        message.trim() || attachedFiles.length > 0
                          ? "bg-[#8C8C8C] text-white hover:bg-[#a3a3a3]"
                          : "bg-[#21262d] text-[#484f58]"
                      }
                    `}
                    title="Send"
                  >
                    <ArrowUp size={18} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* File Preview Modal */}
        <FilePreviewModal
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setPreviewFile(null);
          }}
        />
      </>
    );
  }
);

ChatInput.displayName = "ChatInput";

export default ChatInput;