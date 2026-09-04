"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from "react";
import dynamic from "next/dynamic";
import { Source } from "@/components/Chat/WebSearch/Sources";

// ✅ Lazy load heavy components - ONLY load when needed
const ChatInput = dynamic(
  () => import("@/components/Chat/ChatInput"),
  { 
    ssr: false, 
    loading: () => <div className="h-[120px] animate-pulse bg-gray-800/20 rounded-xl" /> 
  }
);

const NewChat = dynamic(
  () => import("@/components/Chat/NewChat"),
  { ssr: false }
);

// ✅ Lazy load the PDF renderer (pdfjs-dist is heavy — fetched only when a PDF
// preview is opened).
const PdfPreview = dynamic(
  () => import("@/components/Chat/PdfPreview"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2 py-12 text-[#8b949e]">
        <Loader2 size={16} className="animate-spin text-[#1f6feb]" />
        <span>Loading PDF viewer...</span>
      </div>
    ),
  }
);

const MarkdownRenderer = dynamic(
  () => import("@/components/Chat/Renderers/MarkdownRenderer"),
  { 
    ssr: false,
    loading: () => <div className="animate-pulse text-gray-400">Loading content...</div>
  }
);

// ✅ Lightweight icons - import only what you need
import { 
  PanelLeft, 
  Copy, 
  Check, 
  Pencil, 
  RotateCcw, 
  Loader2, 
  AlertCircle,
  FileText,
  File,
  Download,
  Globe,
  ExternalLink,
  Paperclip,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import {
  saveChatSession,
  createChatId,
  generateTitle,
  getChatSession,
  markChatOpened,
  ensureChatsLoaded,
} from "@/lib/chatStorage";
import ModelSelector from "@/components/Chat/ModelSelector";
import ModelsManager from "@/components/Sidebar/ModelsManager";
import Guide from "@/components/Sidebar/Guide";
import {
  getCustomModels,
  getStoredSelectedModel,
  storeSelectedModel,
  isLocalModel,
  describeProvider,
} from "@/lib/modelStore";
import { getTheme, THEME_UPDATED_EVENT } from "@/lib/profile";
import { ocrImageText } from "@/lib/imageOcr";
import {
  consumeFreeTierChat,
  getFreeTierUsage,
} from "@/lib/freeTier";
import { getAnonClientToken } from "@/lib/clientToken";

// Model id used to route through OpenRouter's shared free tier when the user
// has not added their own model yet (auto router → free minimax/nemotron…).
const FREE_TIER_MODEL = "openrouter/free";

type MainChatProps = {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onChatIdChange?: (chatId: string) => void;
  chatId?: string | null;
};

type AttachmentMeta = {
  name: string;
  size: number;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Full prompt sent to the AI (includes extracted file contents). Hidden from the UI. */
  llmContent?: string;
  attachments?: AttachmentMeta[];
  /** Reference websites linked to this assistant reply. */
  sources?: Source[];
};

// =========================================
// Helper: Read File as Text
// =========================================
const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (typeof result === "string") {
          resolve(result);
        } else {
          resolve("Image file (binary data not shown)");
        }
      } catch {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () => reject(new Error("File read error"));

    if (file.type.startsWith("image/")) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
};

// =========================================
// Helper: Convert File → base64
// =========================================
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// =========================================
// Helper: Extract readable text from a file
// (PDF → pdf-parse, Word/Excel → mammoth/SheetJS on the server)
// =========================================
const MAX_FILE_CHARS = 12000;

const extractFileText = async (file: File): Promise<string> => {
  const kind = classifyFile(file);

  if (kind === "image") {
    // ✅ OCR the image so the AI can read any embedded text.
    return await ocrImageText(file);
  }

  if (kind === "pdf" || kind === "docx" || kind === "xlsx" || kind === "xls") {
    try {
      const base64 = await fileToBase64(file);

      if (kind === "pdf") {
        const res = await fetch("/api/parse-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: base64, fileName: file.name }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!data.text || !data.text.trim()) {
          throw new Error(data.message || "The PDF contains no extractable text.");
        }
        return data.text;
      }

      const res = await fetch("/api/preview-file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Token": getAnonClientToken(),
        },
        body: JSON.stringify({
          file: base64,
          fileName: file.name,
          mode: "text",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.text || !data.text.trim()) {
        throw new Error("No extractable text found in this file.");
      }
      return data.text;
    } catch (error) {
      console.error("❌ extractFileText failed:", error);
      throw error;
    }
  }

  return await readFileAsText(file);
};

// =========================================
// File Preview Panel (Right Side) - MEMOIZED
// Renders each file type with a native viewer.
// =========================================

type FileKind =
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "docx"
  | "doc"
  | "xlsx"
  | "xls"
  | "csv"
  | "code"
  | "text"
  | "binary";

function classifyFile(file: File): FileKind {
  const mime = (file.type || "").toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  )
    return "docx";
  if (ext === "doc" || mime === "application/msword") return "doc";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  )
    return "xlsx";
  if (ext === "xls" || mime === "application/vnd.ms-excel") return "xls";
  if (mime === "text/csv" || ext === "csv") return "csv";
  if (
    ["js", "jsx", "ts", "tsx", "py", "java", "html", "css", "json", "xml", "go", "rs", "sql", "sh", "yml", "yaml"].includes(ext)
  )
    return "code";
  if (mime.startsWith("text/") || ["txt", "md", "rtf", "log"].includes(ext))
    return "text";
  return "binary";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function getFavicon(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return null;
  }
}

// Simple CSV parser (handles quoted fields)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

const FILE_META: Record<FileKind, { label: string; color: string }> = {
  pdf: { label: "PDF document", color: "text-red-400" },
  image: { label: "Image", color: "text-blue-400" },
  video: { label: "Video", color: "text-purple-400" },
  audio: { label: "Audio", color: "text-amber-400" },
  docx: { label: "Word document", color: "text-blue-500" },
  doc: { label: "Word document", color: "text-blue-500" },
  xlsx: { label: "Excel spreadsheet", color: "text-green-500" },
  xls: { label: "Excel spreadsheet", color: "text-green-500" },
  csv: { label: "Spreadsheet (CSV)", color: "text-green-500" },
  code: { label: "Code", color: "text-yellow-500" },
  text: { label: "Text file", color: "text-gray-400" },
  binary: { label: "File", color: "text-gray-400" },
};

// Favicon with graceful fallback to the Globe icon
function SourceFavicon({ url, favicon }: { url: string; favicon?: string }) {
  const [failed, setFailed] = useState(false);
  const src = favicon || getFavicon(url);

  if (!src || failed) {
    return <Globe size={15} className="text-blue-400" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={24}
      height={24}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-6 w-6 rounded-md"
    />
  );
}

const FilePreviewPanel = memo(function FilePreviewPanel({
  file,
  sources,
  onClose,
  isOpen,
}: {
  file: File | null;
  sources: Source[] | null;
  onClose: () => void;
  isOpen: boolean;
}) {
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 440;
    try {
      const stored = localStorage.getItem("orcachat_preview_width");
      const w = stored ? parseInt(stored, 10) : NaN;
      return !Number.isNaN(w) ? Math.min(720, Math.max(280, w)) : 440;
    } catch {
      return 440;
    }
  });
  const [collapsed, setCollapsed] = useState(false);
  const panelResizeRef = useRef<{ startX: number; startW: number } | null>(
    null
  );
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [isMobile, setIsMobile] = useState(false);

  // Track phone width so the preview can render full-screen (no inline width)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Keep the preview logo's color in sync with the active theme
  useEffect(() => {
    const sync = () => setThemeMode(getTheme());
    sync();
    window.addEventListener(THEME_UPDATED_EVENT, sync);
    return () => window.removeEventListener(THEME_UPDATED_EVENT, sync);
  }, []);

  // Restore last used preview width is handled by the lazy panelWidth initializer
  // (see useState above), so no effect is needed.

  function startPanelResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    panelResizeRef.current = { startX: e.clientX, startW: panelWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPanelResize(e: React.PointerEvent<HTMLDivElement>) {
    const drag = panelResizeRef.current;
    if (!drag) return;
    const delta = drag.startX - e.clientX;
    const max = Math.min(720, Math.floor((window.innerWidth || 0) * 0.75));
    setPanelWidth(Math.min(max, Math.max(280, drag.startW + delta)));
  }

  function endPanelResize() {
    if (!panelResizeRef.current) return;
    panelResizeRef.current = null;
    try {
      localStorage.setItem("orcachat_preview_width", String(panelWidth));
    } catch {}
  }

  // Close on Escape (no backdrop, so the chat page stays clickable)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URL for native viewers + download. Derived synchronously from the
  // file (created during render), with the previous URL revoked on change.
  const objectUrl = useMemo(() => {
    if (!file || !isOpen) return null;
    return URL.createObjectURL(file);
  }, [file, isOpen]);

  // Revoke each object URL exactly once — when it is replaced or on unmount.
  // Cleanup only (no state set), so there is no cascading-render concern.
  useEffect(() => {
    const current = objectUrl;
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [objectUrl]);

  // Read / convert content per file type. Resetting the preview state whenever
  // a new file is opened is an intentional reset-on-prop-change, so the
  // synchronous setState calls below are the correct pattern here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!file || !isOpen) return;
    let cancelled = false;

    const kind = classifyFile(file);
    setError(null);
    setIsLoading(true);
    setDocHtml(null);
    setTextContent("");
    setCsvRows([]);
    setSheetNames([]);
    setActiveSheet("");

    const readAsBase64 = (f: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve((reader.result as string).split(",")[1] || "");
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(f);
      });

    const readAsText = (f: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(f, "utf-8");
      });

    const requestPreview = async (f: File, sheetIndex = 0) => {
      const res = await fetch("/api/preview-file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Token": getAnonClientToken(),
        },
        body: JSON.stringify({
          fileName: f.name,
          file: await readAsBase64(f),
          sheetIndex,
        }),
      });
      const data = await res.json();
      if (cancelled) return;
      if (data.error) throw new Error(data.error);
      if (data.format === "html") {
        setDocHtml(data.html);
      } else if (data.format === "spreadsheet") {
        setDocHtml(data.html);
        setSheetNames(data.sheetNames || []);
        setActiveSheet(data.activeSheet || "");
      } else if (data.format === "unsupported") {
        setError(data.message || "Preview is not available for this file type.");
      }
    };

    (async () => {
      try {
        if (kind === "docx" || kind === "xlsx" || kind === "xls") {
          await requestPreview(file);
        } else if (kind === "csv") {
          setCsvRows(parseCsv(await readAsText(file)));
        } else if (kind === "code" || kind === "text") {
          setTextContent(await readAsText(file));
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to generate preview");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const switchSheet = useCallback(
    async (index: number) => {
      if (!file) return;
      setIsLoading(true);
      setError(null);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve((reader.result as string).split(",")[1] || "");
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/preview-file", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Token": getAnonClientToken(),
          },
          body: JSON.stringify({ fileName: file.name, file: base64, sheetIndex: index }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.html) setDocHtml(data.html);
        setActiveSheet(data.activeSheet || "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load sheet");
      } finally {
        setIsLoading(false);
      }
    },
    [file]
  );

  if (!isOpen) return null;

  // Collapsed: tuck into a slim tab on the right edge so the chat stays visible
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed inset-y-0 right-0 z-50 flex w-11 flex-col items-center gap-3 border-l border-[#30363d] bg-[#161b22] py-4 text-[#8b949e] transition-colors hover:text-[#c9d1d9]"
        title="Open preview"
      >
        <ChevronLeft size={18} />
        <FileText size={16} className="shrink-0" />
        <span className="text-[10px] font-medium uppercase tracking-widest [writing-mode:vertical-rl]">
          Preview
        </span>
      </button>
    );
  }

  const kind = file ? classifyFile(file) : "binary";
  const meta = FILE_META[kind];
  const lines = file ? textContent.split("\n") : [];

  const renderSources = () => {
    if (!sources) return null;
    return (
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <p className="px-1 pb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[#8b949e]">
          The AI referenced {sources.length} website
          {sources.length > 1 ? "s" : ""}
        </p>
        <div className="space-y-2">
          {sources.map((source, i) => {
            const domain = source.domain || getDomain(source.url);
            return (
              <a
                key={`${source.url}-${i}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2.5 transition-all hover:border-[#1f6feb] hover:bg-[#1c2128]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#30363d] bg-[#21262d]">
                  <SourceFavicon url={source.url} favicon={source.favicon} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#c9d1d9] group-hover:text-[#e6edf3]">
                    {source.title || domain}
                  </p>
                  <p className="truncate text-[11px] text-[#8b949e]">{domain}</p>
                </div>
                <ExternalLink
                  size={14}
                  className="shrink-0 text-[#8b949e] transition group-hover:text-[#1f6feb]"
                />
              </a>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (sources && sources.length > 0) {
      return renderSources();
    }

    if (!file) return null;

    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-[#1f6feb]" />
          <span className="ml-3 text-[#8b949e]">Loading preview...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertCircle size={36} className="text-[#8b949e]" />
          <p className="text-sm text-[#8b949e]">{error}</p>
        </div>
      );
    }

    switch (kind) {
      case "pdf":
        return (
          <PdfPreview file={file} />
        );

      case "image":
        return (
          <div className="grid h-full place-items-center overflow-auto p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={objectUrl || undefined}
              alt={file.name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        );

      case "video":
        return (
          <div className="grid h-full place-items-center overflow-auto p-4">
            <video
              src={objectUrl || undefined}
              controls
              className="max-h-full max-w-full rounded-lg"
            />
          </div>
        );

      case "audio":
        return (
          <div className="grid h-full place-items-center p-4">
            <div className="w-full max-w-md rounded-md border border-[#30363d] bg-[#161b22] p-6">
              <audio src={objectUrl || undefined} controls className="w-full" />
            </div>
          </div>
        );

      case "docx":
        return (
          <div className="h-full overflow-auto bg-[#161b22]">
            {/* Inner wrapper centered via auto margins; it can grow taller
                than the panel so the whole document is always scrollable. */}
            <div className="min-h-full w-fit min-w-full px-4 py-6 mx-auto">
              {/* Render the converted .docx as a clean Word-style page */}
              <div
                className="doc-page w-full max-w-[820px] rounded-md bg-white p-8 text-[#1a1a1a] shadow-2xl"
                dangerouslySetInnerHTML={{ __html: docHtml || "" }}
              />
            </div>
          </div>
        );

      case "xlsx":
      case "xls":
        return (
          <div className="flex h-full min-h-0 flex-col">
            {sheetNames.length > 1 && (
              <div className="flex items-center gap-1 border-b border-[#30363d] px-3 py-2">
                {sheetNames.map((name, i) => (
                  <button
                    key={name}
                    onClick={() => switchSheet(i)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                      activeSheet === name
                        ? "bg-[#1f6feb]/15 text-[#1f6feb]"
                        : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {/* sheet_to_html output (table with inline styles) */}
              <div
                className="inline-block max-w-full overflow-hidden rounded-lg shadow-xl"
                dangerouslySetInnerHTML={{ __html: docHtml || "" }}
              />
            </div>
          </div>
        );

      case "csv":
        return (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {csvRows.map((row, i) => (
                  <tr
                    key={i}
                    className={
                      i === 0 ? "bg-[#161b22]" : "odd:bg-transparent even:bg-[#161b22]"
                    }
                  >
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`max-w-[320px] truncate whitespace-nowrap border-b border-[#30363d] px-3 py-1.5 ${
                          i === 0 ? "font-medium text-[#c9d1d9]" : "text-[#c9d1d9]"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case "code":
      case "text":
        return (
          <div className="h-full overflow-auto">
            <pre className="min-h-full bg-[#161b22] p-4 font-mono text-[12px] leading-6 text-[#c9d1d9]">
              {lines.map((line, i) => (
                <div key={i} className="flex">
                  <span className="w-10 shrink-0 select-none pr-4 text-right text-[#8b949e] tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-words">
                    {line || " "}
                  </span>
                </div>
              ))}
            </pre>
          </div>
        );

      default:
        return (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <File size={44} className="text-[#8b949e]" />
            <div>
              <p className="text-sm font-medium text-[#c9d1d9]">{file.name}</p>
              <p className="mt-1 text-xs text-[#8b949e]">
                {meta.label} • {formatFileSize(file.size)}
              </p>
              <p className="mt-3 text-xs text-[#8b949e]">
                Preview isn&apos;t available for this file type. Download it to open
                locally.
              </p>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      {/* No blocking backdrop - the chat page stays clickable/typeable */}
      <aside
        ref={panelRef}
        className="
          relative z-40 h-full shrink-0 flex flex-col
          max-w-none w-full
          bg-[#161b22] border-l border-[#30363d]
          shadow-2xl
          animate-in slide-in-from-right duration-300

          max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-auto max-md:max-w-none
          md:max-w-[92vw] md:w-auto
        "
        style={{ width: isMobile ? undefined : panelWidth }}
      >
        {/* Resize handle on the left edge */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startPanelResize}
          onPointerMove={onPanelResize}
          onPointerUp={endPanelResize}
          onPointerCancel={endPanelResize}
          className="absolute left-0 top-0 z-10 hidden h-full w-[8px] cursor-ew-resize transition-colors hover:bg-white/[0.05] md:block"
          title="Drag to resize preview"
        >
          <span className="absolute left-[2.5px] top-1/2 h-10 w-[3px] -translate-y-1/2 rounded-full bg-white/15" />
        </div>
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#30363d] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[#21262d] ${
                sources ? "text-[#1f6feb]" : meta.color
              }`}
            >
              {sources ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/orca-logo.png"
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="h-5 w-5 object-contain select-none"
                  style={{
                    filter:
                      themeMode === "dark" ? "none" : "invert(1) brightness(0)",
                  }}
                />
              ) : (
                <FileText size={17} />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-[#c9d1d9]">
                {file ? file.name : "Reference websites"}
              </h3>
              <p className="text-xs text-[#8b949e]">
                {file
                  ? `${meta.label} • ${formatFileSize(file.size)}`
                  : `${sources?.length || 0} sources`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="dc-preview-btn hidden rounded-md p-1.5 text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9] md:inline-flex"
              title="Collapse preview to the side"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={onClose}
              className="dc-preview-btn rounded-md p-1.5 text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden">{renderContent()}</div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-end border-t border-[#30363d] bg-[#161b22] px-4 py-2.5">
          {file ? (
            <a
              href={objectUrl || undefined}
              download={file.name}
              className="flex items-center gap-1.5 rounded-md bg-[#21262d] px-3 py-1.5 text-xs font-medium text-[#c9d1d9] transition hover:bg-[#30363d] hover:text-[#e6edf3]"
            >
              <Download size={13} />
              Download
            </a>
          ) : (
            <span className="text-xs text-[#8b949e]">
              Opens in a new tab
            </span>
          )}
        </div>
      </aside>
    </>
  );
});

// =========================================
// Copy Button Component - MEMOIZED
// =========================================
const CopyButton = memo(function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const cleanContent = content
        .replace(/\*\*/g, "")
        .replace(/### /g, "")
        .replace(/---\s*/g, "")
        .replace(/\*/g, "")
        .replace(/`/g, "")
        .replace(/\n{3,}/g, "\n\n");

      await navigator.clipboard.writeText(cleanContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error("Unable to copy message");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
    >
      {copied ? (
        <Check size={14} className="text-[#3fb950]" />
      ) : (
        <Copy size={14} strokeWidth={1.7} />
      )}
    </button>
  );
});

// =========================================
// Action Button Component - MEMOIZED
// =========================================
const ActionButton = memo(function ActionButton({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
      title={title}
    >
      {icon}
    </button>
  );
});

// =========================================
// Edit Message Component - MEMOIZED
// =========================================
const EditMessage = memo(function EditMessage({
  initialValue,
  onCancel,
  onSave,
}: {
  initialValue: string;
  onCancel: () => void;
  onSave: (content: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="w-full min-w-[300px]">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="min-h-[100px] w-full resize-none rounded-md border border-[#30363d] bg-[#161b22] px-4 py-3 text-[15px] leading-6 text-[#c9d1d9] outline-none focus:border-[#1f6feb]"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(value)}
          disabled={!value.trim()}
          className="rounded-md bg-[#238636] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#2ea043] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
});

// =========================================
// Message Bubble Component - MEMOIZED
// =========================================
const MessageBubble = memo(function MessageBubble({
  message,
  editing,
  onEdit,
  onCancel,
  onSave,
  onRegenerate,
  isLoading,
  isIncomplete,
  onContinue,
  hasSources,
  onShowSources,
  onOpenAttachment,
}: {
  message: Message;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (content: string) => void;
  onRegenerate?: () => void;
  isLoading?: boolean;
  isIncomplete?: boolean;
  onContinue?: () => void;
  hasSources?: boolean;
  onShowSources?: () => void;
  onOpenAttachment?: (index: number) => void;
}) {
  const isUser = message.role === "user";
  const isStreaming = isLoading && message.content === "";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="flex max-w-[85%] flex-col items-end">
          {editing ? (
            <EditMessage
              initialValue={message.content}
              onCancel={onCancel}
              onSave={onSave}
            />
          ) : (
            <>
              <div className="dc-user-bubble rounded-md rounded-br-md border border-[#30363d] bg-[#21262d] px-5 py-3.5 text-[15px] leading-7 text-[#c9d1d9] whitespace-pre-wrap">
                {message.content}
              </div>
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {message.attachments.map((att, i) => (
                    <button
                      key={`${att.name}-${i}`}
                      type="button"
                      onClick={() => onOpenAttachment?.(i)}
                      disabled={!onOpenAttachment}
                      className={`flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2.5 text-[12px] text-[#c9d1d9] ${
                        onOpenAttachment
                          ? "transition hover:border-[#1f6feb] hover:bg-[#1c2128] hover:text-[#e6edf3]"
                          : "cursor-default"
                      }`}
                      title={
                        onOpenAttachment
                          ? `Preview ${att.name}`
                          : `${att.name} (${(att.size / 1024).toFixed(1)} KB)`
                      }
                    >
                      <Paperclip size={12} className="shrink-0 text-[#8b949e]" />
                      <span className="truncate">{att.name}</span>
                      <span className="shrink-0 text-[10px] text-[#8b949e]">
                        {(att.size / 1024).toFixed(1)} KB
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-1 flex items-center gap-1">
                <CopyButton content={message.content} />
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
                >
                  <Pencil size={14} strokeWidth={1.7} />
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 max-w-[85%] gap-3">
          <div className="min-w-0 flex-1">
            {isStreaming ? (
              <div className="flex items-center gap-2 text-[#8b949e] py-1">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-sm font-mono">Thinking...</span>
              </div>
            ) : (
              <div className="min-w-0 whitespace-pre-wrap">
                <MarkdownRenderer content={message.content} />
              </div>
            )}
            <div className="mt-2 flex items-center gap-1">
              <CopyButton content={message.content} />
              <ActionButton
                icon={<RotateCcw size={13} />}
                title="Regenerate"
                onClick={onRegenerate}
              />
              {hasSources && onShowSources && (
                <button
                  type="button"
                  onClick={onShowSources}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-[#30363d] px-2 text-[11px] font-mono text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#c9d1d9]"
                  title="View reference websites"
                >
                  <Globe size={13} />
                  Websites
                </button>
              )}
            </div>
            {!isUser && onContinue && isIncomplete && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={onContinue}
                  disabled={isLoading}
                  className="
                    flex items-center gap-1.5
                    px-3 py-1.5
                    text-xs font-medium font-mono
                    text-[#8b949e]
                    border border-[#30363d]
                    rounded-md
                    hover:bg-[#21262d]
                    hover:text-[#c9d1d9]
                    hover:border-[#484f58]
                    transition-all
                    disabled:opacity-40
                    disabled:cursor-not-allowed
                  "
                >
                  <span>Continue</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// =========================================
// Privacy Indicator Component - MEMOIZED
// Shows whether the current model is local (data stays on device) or remote
// (prompts are sent to a third-party provider).
// =========================================
const PrivacyIndicator = memo(function PrivacyIndicator({
  isLocal,
  provider,
}: {
  isLocal: boolean;
  provider: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [openRight, setOpenRight] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          // Open the popover on the side with enough room so no part is hidden.
          const b = ref.current?.getBoundingClientRect();
          const boxW = 300;
          // Opening LEFT (right-0) extends the boxW from the badge's right
          // edge; if that would go off the left edge, flip to opening RIGHT.
          const leftEdge = (b?.right ?? 0) - boxW;
          setOpenRight(leftEdge < 8);
          setOpen((o) => !o);
        }}
        title={
          isLocal
            ? "Local model — your data stays on this device"
            : `Remote model (${provider}) — prompts are sent to this provider`
        }
        className={`dc-privacy-badge flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-all ${
          isLocal
            ? "border-[#238636]/40 bg-[#238636]/10 text-[#3fb950] hover:border-[#2ea043]/60"
            : "border-[#30363d] bg-[#161b22] text-[#8b949e] hover:border-[#484f58] hover:bg-[#21262d] hover:text-[#c9d1d9]"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isLocal ? "bg-[#3fb950]" : "bg-[#8b949e]"
          }`}
        />
        {isLocal ? "Local" : "Online"}
      </button>

      {open && (
        <div className={`dc-popover absolute top-[110%] z-50 w-[300px] rounded-md border border-[#30363d] bg-[#161b22] p-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.5)] ring-1 ring-black/50 animate-in zoom-in-95 duration-150 ${
          openRight
            ? "left-0 origin-top-left max-md:max-w-[70vw]"
            : "right-0 origin-top-right max-md:w-[260px] max-md:max-w-[70vw]"
        }`}>
          <p className="text-[13px] font-semibold text-[#e6edf3]">
            {isLocal ? "Local model" : "Online model"}
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#8b949e]">
            {isLocal
              ? "This model runs entirely on your device. Your prompts and chats never leave this machine."
              : `This model runs on ${provider}. Your current prompt and recent context are sent to that provider to generate a reply.`}
          </p>
        </div>
      )}
    </div>
  );
});

// =========================================
// MainChat Component
// =========================================
export default function MainChat({
  sidebarOpen,
  onOpenSidebar,
  onChatIdChange,
  chatId: externalChatId,
}: MainChatProps) {
  // --- State ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [sourcesByMessage, setSourcesByMessage] = useState<
    Record<number, Source[]>
  >({});
  const [filesByMessage, setFilesByMessage] = useState<Record<number, File[]>>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    externalChatId || null
  );
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewSources, setPreviewSources] = useState<Source[] | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isIncomplete, setIsIncomplete] = useState(false);
  const [lastAssistantId, setLastAssistantId] = useState<number | null>(null);

  // --- Model State ---
  // NOTE: no localStorage reads here (would break SSR hydration). Stored
  // model is restored after mount in the effect below. Defaults to the free
  // tier router until a custom model is selected or restored.
  const [selectedModelId, setSelectedModelId] = useState(FREE_TIER_MODEL);
  const [selectedModelApiKey, setSelectedModelApiKey] = useState("");
  const [selectedModelBaseUrl, setSelectedModelBaseUrl] = useState("");
  const [freeLimitReached, setFreeLimitReached] = useState(false);
  const [showModelsManager, setShowModelsManager] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    let active = true;
    getStoredSelectedModel().then((stored) => {
      if (!active || !stored) return;
      getCustomModels().then((models) => {
        const model = models.find((m) => m.modelId === stored);
        if (active) {
          setSelectedModelId(stored);
          setSelectedModelApiKey(model?.apiKey || "");
          setSelectedModelBaseUrl(model?.baseUrl || "");
        }
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const handleModelChange = useCallback(
    (model: {
      modelId: string;
      apiKey?: string;
      baseUrl?: string;
      name: string;
    }) => {
      setSelectedModelId(model.modelId);
      setSelectedModelApiKey(model.apiKey || "");
      setSelectedModelBaseUrl(model.baseUrl || "");
      setFreeLimitReached(false);
      storeSelectedModel(model.modelId);
    },
    []
  );

  useEffect(() => {
    const openManager = () => setShowModelsManager(true);
    window.addEventListener("open-models-manager", openManager);
    return () =>
      window.removeEventListener("open-models-manager", openManager);
  }, []);

  // When a model is added in the Models manager it becomes the active model
  // immediately (the manager dispatches this event after persisting the key).
  useEffect(() => {
    const onModelAdded = (e: Event) => {
      const model = (e as CustomEvent).detail as {
        modelId: string;
        apiKey?: string;
        baseUrl?: string;
        name: string;
      };
      if (model?.modelId) handleModelChange(model);
    };
    window.addEventListener("model-selected", onModelAdded);
    return () => window.removeEventListener("model-selected", onModelAdded);
  }, [handleModelChange]);

  // --- Refs ---
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const userScrolledUpRef = useRef(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  // Timer for the theme crossfade (removes the body fade class after it ends).
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<{ setInput: (value: string) => void } | null>(
    null
  );
  // Tracks whether THIS instance is still on screen. When the user switches to
  // another chat mid-generation, the fetch keeps running in the background (so
  // the reply is never lost) but state updates are skipped.
  const mountedRef = useRef(true);
  // Live copy of the currently-viewed chat id. A background stream compares its
  // captured chatId against this before mutating React state, so a stale reply
  // can never be written into a different chat's view after the user switches.
  const currentChatIdRef = useRef<string | null>(currentChatId);
  // Throttle partial writes to storage so a background stream stays recoverable.
  const lastStreamSaveRef = useRef(0);
  // Throttle in-memory re-renders during streaming: we only push a state update
  // every ~40ms instead of on every token, then flush the tail when done.
  const lastStreamRenderRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // State updater that no-ops after unmount (background streams keep persisting
  // to storage but never touch React state of a dead instance).
  const updateMsgs = useCallback(
    (fn: (prev: Message[]) => Message[]) => {
      if (mountedRef.current) setMessages(fn);
    },
    []
  );

  // --- Effects ---
  useEffect(() => {
    let cancelled = false;
    // Switching chats (new chat or selecting another) must stop any in-flight
    // streaming request. The fetch keeps running long enough to persist its
    // partial reply to the ORIGINAL chat via persistStream's captured chatId,
    // but aborting prevents it from writing tokens into the newly-selected
    // chat's React state (a stale stream must never contaminate another chat).
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    (async () => {
      await ensureChatsLoaded();
      if (cancelled) return;
      if (externalChatId) {
        const session = getChatSession(externalChatId);
        if (session) {
          setCurrentChatId(session.id);
          currentChatIdRef.current = session.id;
          setMessages(session.messages);
          // ✅ Restore reference websites attached to saved replies
          const sbm: Record<number, Source[]> = {};
          session.messages.forEach(
            (m) => {
              if (m.role === "assistant" && m.sources && m.sources.length) {
                sbm[m.id] = m.sources;
              }
            }
          );
          setSourcesByMessage(sbm);
          setFilesByMessage({});
          setError(null);
          // Reset the 7-day auto-delete timer for this chat on open.
          markChatOpened(session.id);
          onChatIdChange?.(session.id);
        }
      } else {
        // Parent has no active chat selected (e.g. "New Chat"): reset to a
        // fresh empty conversation. This runs both on first mount (when
        // currentChatId is null) and when switching away to a new chat.
        const newId = createChatId();
        setCurrentChatId(newId);
        currentChatIdRef.current = newId;
        setMessages([]);
        setSourcesByMessage({});
        setFilesByMessage({});
        setError(null);
        setIsLoading(false);
        setIsIncomplete(false);
        setLastAssistantId(null);
        setEditingId(null);
        setPreviewFile(null);
        setPreviewSources(null);
        setIsPreviewOpen(false);
        setFreeLimitReached(false);
        onChatIdChange?.(newId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [externalChatId, onChatIdChange]);

  // Stay pinned to the bottom while content streams in, just like top-tier
  // chat apps (ChatGPT/Claude): as long as the user is at the bottom, we follow
  // every token synchronously BEFORE the browser paints (useLayoutEffect), so
  // there's no visible "jump" frame — the view glides down with the text as it
  // streams. The instant we detect the user scrolling up, this stops following
  // and never forces their position; the scroll-arrow button restores it.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (messages.length === 0 || userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    userScrolledUpRef.current = !atBottom;
    setIsUserScrolledUp((prev) => (prev !== !atBottom ? !atBottom : prev));
    // Show the top shadow as soon as content scrolls under the header line.
    setShowTopShadow(el.scrollTop > 8);
  }, []);

  // Keep the shadow gradient's color in sync with the active theme, and run a
  // brief crossfade so the dark/light switch feels smooth app-wide.
  useEffect(() => {
    const sync = () => setThemeMode(getTheme());
    sync(); // match the stored theme after hydration (SSR-safe start = dark)
    window.addEventListener(THEME_UPDATED_EVENT, sync);

    // Fade the whole <body> on an actual theme change (covers sidebar + chat +
    // modals), then remove the animation class so it can replay next time.
    const startFade = () => {
      const b = document.body;
      b.classList.remove("dc-theme-fade");
      // Force reflow so removing+re-adding replays the animation.
      void b.offsetWidth;
      b.classList.add("dc-theme-fade");
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(
        () => b.classList.remove("dc-theme-fade"),
        340
      );
    };
    window.addEventListener(THEME_UPDATED_EVENT, startFade);

    return () => {
      window.removeEventListener(THEME_UPDATED_EVENT, sync);
      window.removeEventListener(THEME_UPDATED_EVENT, startFade);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // --- Helpers ---
  const saveChatToStorage = useCallback(
    (chatMessages: Message[]) => {
      if (!currentChatId || chatMessages.length === 0) return;

      const existingSession = getChatSession(currentChatId);
      saveChatSession({
        id: currentChatId,
        title: generateTitle(chatMessages),
        messages: chatMessages,
        createdAt: existingSession?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
    [currentChatId]
  );

  // --- FETCH AI RESPONSE WITH STREAMING ---
  const fetchAIResponse = useCallback(
    async (
      userMessages: Message[],
      replaceMessageId?: number
    ): Promise<{ content: string; id: number; sources: Source[] } | null> => {
      abortControllerRef.current = new AbortController();

      setIsIncomplete(false);
      setLastAssistantId(null);

      let assistantMessage: Message | null = null;
      let fullResponse = "";
      let streamSources: Source[] = [];

      // The chat this request belongs to, captured up front so a background
      // stream (after the user switches chat) still writes to the right place.
      const chatId = currentChatId;

      // True only while the user is still viewing THIS chat. Guard every React
      // state mutation below with this so a background stream that keeps running
      // after a chat switch writes to storage (via persistStream) but never
      // corrupts the currently-viewed chat's state.
      const isCurrentChat = () => currentChatIdRef.current === chatId;

      // Persist partial streaming progress to storage (append or replace the
      // assistant message). Lets you switch chats mid-generation and come back
      // to the finished/streaming reply without losing anything.
      const persistStream = (partial: Message) => {
        if (!chatId) return;
        const existing = getChatSession(chatId);
        if (!existing) return;
        const idx = existing.messages.findIndex((m) => m.id === partial.id);
        let msgs: Message[];
        if (idx === -1) {
          msgs = [...existing.messages, partial];
        } else {
          msgs = existing.messages.slice();
          msgs[idx] = {
            ...msgs[idx],
            content: partial.content,
            sources: partial.sources,
          };
        }
        saveChatSession({
          id: chatId,
          title: existing.title || generateTitle(msgs),
          messages: msgs,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        });
      };

      try {
        console.log("🚀 Sending to API with model:", selectedModelId);

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Token": getAnonClientToken(),
          },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            model: selectedModelId,
            apiKey: selectedModelApiKey || undefined,
            baseUrl: selectedModelBaseUrl || undefined,
            messages: userMessages.map((msg) => ({
              role: msg.role,
              content: msg.llmContent ?? msg.content,
            })),
            webSearch: webSearchEnabled,
            webSearchQuery: (() => {
              const last = [...userMessages]
                .reverse()
                .find((m) => m.role === "user");
              return last?.content || "";
            })(),
            timezone: (() => {
              try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
              } catch {
                return "UTC";
              }
            })(),
          }),
        });

        if (!response.ok) {
          const rawText = await response.text();
          let errorData: { error?: unknown; response?: unknown } = {};
          try { errorData = JSON.parse(rawText); } catch {}
          console.error(`❌ API Error (status ${response.status}):`, rawText || errorData);
          throw new Error(
            (errorData.error as string) ||
            (errorData.response as string) ||
            `API Error ${response.status}: ${(rawText || "").slice(0, 120)}`
          );
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        if (!reader) {
          throw new Error("No reader available");
        }

        assistantMessage = {
          id: replaceMessageId ?? Date.now() + 1,
          role: "assistant",
          content: "",
        };

        if (replaceMessageId) {
          // ✅ Regenerate: replace the target assistant message in place,
          // preserving the rest of the conversation.
          if (isCurrentChat()) {
            updateMsgs((prev) =>
              prev.map((msg) =>
                msg.id === replaceMessageId
                  ? { ...msg, content: "", llmContent: undefined, sources: undefined }
                  : msg
              )
            );
          }
        } else {
          if (isCurrentChat()) {
            updateMsgs((prev) => [...prev, assistantMessage!]);
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (trimmedLine.startsWith("data: ")) {
              const data = trimmedLine.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);

                // Web search reference websites (sent before the text stream)
                if (parsed.type === "sources" && Array.isArray(parsed.data)) {
                  streamSources = parsed.data;
                  continue;
                }

                // Non-streamed / cached full response
                if (typeof parsed.response === "string" && parsed.response) {
                  if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
                    streamSources = parsed.sources;
                  }
                  fullResponse = parsed.response;
                  if (isCurrentChat()) {
                    updateMsgs((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage!.id
                          ? { ...msg, content: fullResponse }
                          : msg
                      )
                    );
                  }
                  continue;
                }

                const content = parsed.choices?.[0]?.delta?.content;
                const finishReason = parsed.choices?.[0]?.finish_reason;

                if (content) {
                  fullResponse += content;
                  // Throttled render: batch token updates to ~40ms intervals so
                  // we don't re-render the whole tree on every streamed token.
                  const now = Date.now();
                  if (now - lastStreamRenderRef.current > 40) {
                    lastStreamRenderRef.current = now;
                    if (isCurrentChat()) {
                      updateMsgs((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessage!.id
                            ? { ...msg, content: fullResponse }
                            : msg
                        )
                      );
                    }
                  }
                  // ✅ Persist partial progress (throttled) so switching chats
                  // mid-stream never loses the in-progress reply.
                  if (now - lastStreamSaveRef.current > 400) {
                    lastStreamSaveRef.current = now;
                    persistStream({
                      ...assistantMessage!,
                      content: fullResponse,
                      sources: streamSources,
                    });
                  }
                }

                if (finishReason === "length") {
                  console.log("⚠️ Response incomplete due to token limit");
                  if (isCurrentChat()) {
                    setIsIncomplete(true);
                    setLastAssistantId(assistantMessage!.id);
                  }
                }
              } catch {
                console.error("❌ Failed to parse JSON:", data);
              }
            }
          }
        }

        // Flush any content that was throttled out of the last render window
        // so the final reply always matches the streamed text exactly.
        if (fullResponse && assistantMessage && isCurrentChat()) {
          updateMsgs((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessage!.id
                ? { ...msg, content: fullResponse }
                : msg
            )
          );
        }

        if (streamSources.length > 0 && assistantMessage) {
          const srcMsgId = assistantMessage.id;
          if (isCurrentChat()) {
            setSourcesByMessage((prev) => ({
              ...prev,
              [srcMsgId]: streamSources,
            }));
          }
        }

        // ✅ Final save — replace/append the finished assistant message.
        if (chatId && fullResponse && assistantMessage) {
          persistStream({
            ...assistantMessage,
            content: fullResponse,
            sources: streamSources,
          });
        }

        if (!assistantMessage) return null;
        return {
          content: fullResponse,
          id: assistantMessage.id,
          sources: streamSources,
        };
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") {
          console.log("🛑 Request cancelled by user");

          if (assistantMessage) {
            if (fullResponse) {
              // ✅ Keep the partial response so the user can continue from it.
              // Only touch the visible chat's React state if we are still
              // viewing this chat; otherwise the partial reply is already
              // persisted to the original chat below via persistStream.
              if (isCurrentChat()) {
                updateMsgs((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage!.id
                      ? { ...msg, content: fullResponse }
                      : msg
                  )
                );
                setIsIncomplete(true);
                setLastAssistantId(assistantMessage.id);
              }

              persistStream({
                ...assistantMessage,
                content: fullResponse,
                sources: streamSources,
              });
            } else {
              // ✅ Nothing streamed yet - remove the empty bubble (only if we
              // are still viewing this chat)
              if (isCurrentChat()) {
                updateMsgs((prev) =>
                  prev.filter((msg) => msg.id !== assistantMessage!.id)
                );
              }
            }
          }
          return null;
        }
        console.error("❌ API Error:", error);
        throw error;
      }
    },
    [selectedModelId, selectedModelApiKey, selectedModelBaseUrl, currentChatId, webSearchEnabled, updateMsgs]
  );

  // --- SEND MESSAGE ---
  const handleSend = useCallback(
    async (content: string, files?: File[]) => {
      const trimmedContent = content.trim();
      if (!trimmedContent && (!files || files.length === 0)) return;

      setError(null);

      // Free-tier limit: hard cap of FREE_TIER_LIMIT sends per chat on the
      // free tier (no custom model). Once the budget for this chat is used up,
      // sending is blocked entirely until the user starts a new chat (a new
      // session resets the budget) or adds their own model.
      const onFreeTier = !selectedModelApiKey && !selectedModelBaseUrl;
      if (onFreeTier) {
        const current = getFreeTierUsage(currentChatId ?? "");
        if (current.remaining <= 0) {
          setFreeLimitReached(true);
          setError(
            "You've used your 10 free replies for this chat. Start a new chat or add your own model to continue."
          );
          return;
        }
        consumeFreeTierChat(currentChatId ?? "");
        setFreeLimitReached(current.remaining - 1 <= 0);
      }

      userScrolledUpRef.current = false;

      let fullMessage = trimmedContent;

      if (files && files.length > 0) {
        let fileContent = "";

        for (const file of files) {
          try {
            const text = await extractFileText(file);
            const cleaned = text.trim().slice(0, MAX_FILE_CHARS);
            if (cleaned) {
              fileContent += `\n\n[Attached file: ${file.name}]\n${cleaned}\n`;
            } else {
              fileContent += `\n\n[Attached file: ${file.name}] (could not read text)\n`;
            }
          } catch (error) {
            console.error("Error reading file:", error);
            fileContent += `⚠️ Could not read file: ${file.name}\n`;
          }
        }

        if (trimmedContent) {
          fullMessage = `${trimmedContent}${fileContent}\n\nPlease directly answer or analyze using the attached file contents. Do NOT mention the file name, its size, or its format in your reply.`;
        } else {
          fullMessage = `Please analyze the attached file(s).${fileContent}\n\nRespond directly and naturally. Do NOT mention the file name, its size, or its format in your reply.`;
        }
      }

      if (!fullMessage.trim()) return;

      const userMessage: Message = {
        id: Date.now(),
        role: "user",
        content: trimmedContent || (files && files.length > 0
          ? "Please analyze the attached files:"
          : ""),
        ...(files && files.length > 0
          ? {
              llmContent: fullMessage,
              attachments: files.map((f) => ({
                name: f.name,
                size: f.size,
              })),
            }
          : trimmedContent
          ? { llmContent: fullMessage }
          : {}),
      };

      if (files && files.length > 0) {
        setFilesByMessage((prev) => ({
          ...prev,
          [userMessage.id]: files,
        }));
      }

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setIsLoading(true);

      saveChatToStorage(updatedMessages);

      try {
        const aiResponse = await fetchAIResponse(updatedMessages);

        if (aiResponse === null) {
          setIsLoading(false);
          return;
        }

        const assistantMessage: Message = {
          id: aiResponse.id,
          role: "assistant",
          content: aiResponse.content,
          sources: aiResponse.sources.length > 0 ? aiResponse.sources : undefined,
        };

        const finalMessages = [...updatedMessages, assistantMessage];
        setMessages(finalMessages);
        setError(null);

        saveChatToStorage(finalMessages);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("❌ Error in handleSend:", error);
        setError(errMsg || "Failed to get AI response");

        const errorMessage: Message = {
          id: Date.now() + 1,
          role: "assistant",
          content: `⚠️ **Error:** ${errMsg || "Failed to connect to AI service. Please try again."}`,
        };
        const finalMessages = [...updatedMessages, errorMessage];
        setMessages(finalMessages);
        saveChatToStorage(finalMessages);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, saveChatToStorage, fetchAIResponse, selectedModelApiKey, selectedModelBaseUrl, currentChatId]
  );

  // --- CONTINUE GENERATION ---
  // --- CONTINUE GENERATION ---
const handleContinue = useCallback(async () => {
  if (!lastAssistantId) return;

  // Free-tier hard block: continuing also draws on the shared key, so on the
  // free tier (no custom model) refuse once this chat's budget is exhausted.
  const onFreeTier = !selectedModelApiKey && !selectedModelBaseUrl;
  if (onFreeTier && getFreeTierUsage(currentChatId ?? "").remaining <= 0) {
    setFreeLimitReached(true);
    setError(
      "You've used your 10 free replies for this chat. Start a new chat or add your own model to continue."
    );
    return;
  }

  console.log("🔄 Continuing generation...");

  // ✅ Find the last assistant message
  const assistantIndex = messages.findIndex((msg) => msg.id === lastAssistantId);
  if (assistantIndex === -1) return;

  // ✅ Get all messages up to the assistant message
  const messagesUpToAssistant = messages.slice(0, assistantIndex + 1);
  
  // ✅ Find the user message that started this conversation
  let userMessageIndex = assistantIndex - 1;
  while (userMessageIndex >= 0 && messages[userMessageIndex].role !== "user") {
    userMessageIndex--;
  }
  
  if (userMessageIndex < 0) return;

  // ✅ Get the current assistant content
  const currentContent = messages[assistantIndex]?.content || "";

  setIsLoading(true);
  setError(null);

  try {
    // ✅ Send the entire conversation context + continue instruction
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Token": getAnonClientToken(),
      },
      body: JSON.stringify({
        model: selectedModelId,
        apiKey: selectedModelApiKey || undefined,
        baseUrl: selectedModelBaseUrl || undefined,
        messages: [
          // ✅ Send all messages before the assistant response
          ...messagesUpToAssistant.map((msg) => ({
            role: msg.role,
            content: msg.llmContent ?? msg.content,
          })),
          // ✅ Add instruction to continue
          {
            role: "user",
            content: `Please continue your previous response exactly from where you stopped. Do not repeat what you already said. Continue naturally with the next part.`,
          },
        ],
        webSearch: webSearchEnabled,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.response || `API Error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullResponse = currentContent; // ✅ Start with existing content
    let buffer = "";

    if (!reader) {
      throw new Error("No reader available");
    }

    // ✅ Create a new assistant message with existing content (keep reference websites)
    const originalMsg = messages[assistantIndex];
    const continueMessage: Message = {
      id: Date.now() + 1,
      role: "assistant",
      content: currentContent,
      sources: originalMsg?.sources,
    };

    // ✅ Replace the existing assistant message
    updateMsgs((prev) => {
      const newMessages = [...prev];
      newMessages[assistantIndex] = continueMessage;
      return newMessages;
    });

    // ✅ Stream the continuation
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (trimmedLine.startsWith("data: ")) {
          const data = trimmedLine.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (content) {
              fullResponse += content;
              updateMsgs((prev) =>
                prev.map((msg) =>
                  msg.id === continueMessage.id
                    ? { ...msg, content: fullResponse }
                    : msg
                )
              );

              // ✅ Persist partial progress (throttled) so switching chats
              // mid-continue never loses the in-progress reply.
              const now = Date.now();
              if (now - lastStreamSaveRef.current > 400 && currentChatId) {
                lastStreamSaveRef.current = now;
                const existing = getChatSession(currentChatId);
                if (existing) {
                  const msgs = existing.messages.map((m) =>
                    m.id === continueMessage.id ? { ...m, content: fullResponse } : m
                  );
                  saveChatSession({
                    id: currentChatId,
                    title: generateTitle(msgs),
                    messages: msgs,
                    createdAt: existing.createdAt,
                    updatedAt: new Date().toISOString(),
                  });
                }
              }
            }

            if (finishReason === "length") {
              setIsIncomplete(true);
              setLastAssistantId(continueMessage.id);
            } else {
              setIsIncomplete(false);
              setLastAssistantId(null);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // ✅ Save to storage
    if (currentChatId) {
      const existingSession = getChatSession(currentChatId);
      const finalMessages = messages.map((msg) =>
        msg.id === continueMessage.id
          ? { ...msg, content: fullResponse }
          : msg
      );
      saveChatSession({
        id: currentChatId,
        title: generateTitle(finalMessages),
        messages: finalMessages,
        createdAt: existingSession?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    console.log("✅ Continue complete. Total length:", fullResponse.length);
    setIsLoading(false);

  } catch (error) {
    console.error("❌ Continue Error:", error);
    setError(error instanceof Error ? error.message : "Failed to continue generation");
    setIsLoading(false);
  }
}, [messages, lastAssistantId, selectedModelId, selectedModelApiKey, selectedModelBaseUrl, currentChatId, webSearchEnabled, updateMsgs]);

  // --- REGENERATE ---
  const handleRegenerate = useCallback(
    async (messageId: number) => {
      const messageIndex = messages.findIndex((msg) => msg.id === messageId);
      if (messageIndex === -1) return;

      let userMessageIndex = messageIndex - 1;
      while (
        userMessageIndex >= 0 &&
        messages[userMessageIndex].role !== "user"
      ) {
        userMessageIndex--;
      }

      if (userMessageIndex < 0) return;

      // ✅ Regenerate professionally: replace ONLY the target assistant
      // response in place, keeping the entire rest of the conversation intact
      // (no truncating/removing later turns).
      const targetId = messages[messageIndex].id;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === targetId
            ? { ...msg, content: "", llmContent: undefined, sources: undefined }
            : msg
        )
      );

      setIsLoading(true);
      try {
        // Send only the history up to the user prompt for context.
        const contextMessages = messages.slice(0, userMessageIndex + 1);
        const aiResponse = await fetchAIResponse(contextMessages, targetId);

        if (aiResponse) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === targetId
                ? {
                    ...msg,
                    content: aiResponse.content,
                    sources:
                      aiResponse.sources.length > 0
                        ? aiResponse.sources
                        : undefined,
                  }
                : msg
            )
          );
          saveChatToStorage(
            messages.map((msg) =>
              msg.id === targetId
                ? {
                    ...msg,
                    content: aiResponse.content,
                    sources:
                      aiResponse.sources.length > 0
                        ? aiResponse.sources
                        : undefined,
                  }
                : msg
            )
          );
          setError(null);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setError(errMsg || "Failed to regenerate response");

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === targetId
              ? {
                  ...msg,
                  content: `⚠️ **Error:** ${errMsg || "Failed to regenerate response. Please try again."}`,
                }
              : msg
          )
        );
        saveChatToStorage(
          messages.map((msg) =>
            msg.id === targetId
              ? {
                  ...msg,
                  content: `⚠️ **Error:** ${errMsg || "Failed to regenerate response. Please try again."}`,
                }
              : msg
          )
        );
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, fetchAIResponse, saveChatToStorage]
  );

  // --- Edit Message ---
  // --- Edit Message ---
const editMessage = useCallback(
  async (id: number, content: string) => {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    // ✅ Find the message index
    const messageIndex = messages.findIndex((msg) => msg.id === id);
    if (messageIndex === -1) return;

    const message = messages[messageIndex];
    
    // ✅ If it's a user message, remove all messages after it and resend
    if (message.role === "user") {
      // ✅ Keep messages up to this user message
      const messagesUpToEdit = messages.slice(0, messageIndex + 1);
      
      // ✅ Update the user message content
      const updatedMessages = [...messagesUpToEdit];
      updatedMessages[messageIndex] = { 
        ...message, 
        content: trimmedContent,
        llmContent: undefined,
      };
      
      // ✅ Update state and storage
      setMessages(updatedMessages);
      setEditingId(null);
      saveChatToStorage(updatedMessages);
      
      // ✅ Remove any assistant messages after this user message
      const newMessages = updatedMessages.slice(0, messageIndex + 1);
      setMessages(newMessages);
      
      // ✅ Resend the edited message
      setIsLoading(true);
      try {
        const aiResponse = await fetchAIResponse(newMessages);
        
        if (aiResponse) {
          const assistantMessage: Message = {
            id: aiResponse.id,
            role: "assistant",
            content: aiResponse.content,
            sources: aiResponse.sources.length > 0 ? aiResponse.sources : undefined,
          };
          const finalMessages = [...newMessages, assistantMessage];
          setMessages(finalMessages);
          saveChatToStorage(finalMessages);
          setError(null);
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to get AI response");
      } finally {
        setIsLoading(false);
      }
    } else {
      // ✅ If it's an assistant message, just update it
      const updatedMessages = [...messages];
      updatedMessages[messageIndex] = { ...message, content: trimmedContent };
      setMessages(updatedMessages);
      setEditingId(null);
      saveChatToStorage(updatedMessages);
    }
  },
  [messages, fetchAIResponse, saveChatToStorage]
);

  // --- File Preview Handler ---
  const handleFilePreview = useCallback(
    (file: File) => {
      setPreviewSources(null);
      setPreviewFile(file);
      setIsPreviewOpen(true);
    },
    []
  );

  // --- Reference Websites Preview Handler ---
  const openSourcesPreview = useCallback(
    (srces: Source[]) => {
      setPreviewFile(null);
      setPreviewSources(srces);
      setIsPreviewOpen(true);
    },
    []
  );

  const hasMessages = messages.length > 0;

  // Privacy indicator: whether the current model runs locally (no data leaves
  // the device) or remotely (prompts are sent to a provider). Memoized since the
  // provider is fixed until the model changes and checks run on every render.
  const { currentIsLocal, currentProvider } = useMemo(
    () => ({
      currentIsLocal: isLocalModel(selectedModelId, selectedModelBaseUrl),
      currentProvider: describeProvider(selectedModelId),
    }),
    [selectedModelId, selectedModelBaseUrl]
  );

  // Stable handler identities so memo'd children (ChatInput etc.) don't
  // re-render when only parent state changes.
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setPreviewFile(null);
    setPreviewSources(null);
  }, []);

  const handleFileRemove = useCallback(
    (file: File) => {
      if (previewFile === file) {
        closePreview();
      }
    },
    [previewFile, closePreview]
  );

  const handleOpenModelsManager = useCallback(() => setShowModelsManager(true), []);
  const handleOpenGuide = useCallback(() => setShowGuide(true), []);

  // Stable per-message handler identities so the memo'd MessageBubble skips
  // re-rendering for bubbles whose content didn't change during streaming.
  const messageHandlers = useMemo(() => {
    const map: Record<
      number,
      {
        onEdit: () => void;
        onCancel: () => void;
        onSave: (c: string) => void;
        onRegenerate: () => void;
        onShowSources: (() => void) | undefined;
        onOpenAttachment: ((i: number) => void) | undefined;
      }
    > = {};
    for (const msg of messages) {
      const srcs =
        sourcesByMessage[msg.id] || msg.sources || [];
      const files = filesByMessage[msg.id];
      map[msg.id] = {
        onEdit: () => setEditingId(msg.id),
        onCancel: () => setEditingId(null),
        onSave: (c) => editMessage(msg.id, c),
        onRegenerate: () => handleRegenerate(msg.id),
        onShowSources:
          srcs.length > 0
            ? () => openSourcesPreview(srcs)
            : undefined,
        onOpenAttachment:
          msg.role === "user" && files && files.length > 0
            ? (i) => {
                const f = files[i];
                if (f) handleFilePreview(f);
              }
            : undefined,
      };
    }
    return map;
  }, [
    messages,
    sourcesByMessage,
    filesByMessage,
    editMessage,
    handleRegenerate,
    openSourcesPreview,
    handleFilePreview,
  ]);

  return (
    <>
      <div className="flex min-w-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col bg-[#0d1117] min-h-0 transition-[width] duration-300 sm:min-w-[440px]">

        {/* In-flow header: keeps content clipped BELOW the divider line */}
        <header className="relative z-30 flex shrink-0 flex-col">
          <div className="flex min-h-[60px] items-center px-2 sm:px-4">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={onOpenSidebar}
                className="group flex h-10 w-10 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-[#8b949e] transition-all hover:border-[#484f58] hover:bg-[#21262d] hover:text-[#c9d1d9]"
              >
                <PanelLeft size={19} strokeWidth={1.5} />
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <PrivacyIndicator
                isLocal={currentIsLocal}
                provider={currentProvider}
              />
              <ModelSelector
                selectedModelId={selectedModelId}
                fallbackModelId={FREE_TIER_MODEL}
                onModelChange={handleModelChange}
              />
              <button
                onClick={() => setShowGuide(true)}
                className="group flex h-9 items-center rounded-md border border-[#30363d] bg-[#161b22] px-4 text-sm font-medium text-[#8b949e] transition-all hover:border-[#484f58] hover:bg-[#21262d] hover:text-[#c9d1d9]"
              >
                Guide
              </button>
            </div>
          </div>
          {/* Soft fade that hides content as it scrolls under the header line */}
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-full h-6 transition-opacity duration-300 ${
              showTopShadow ? "opacity-100" : "opacity-0"
            }`}
            style={{
              background: `linear-gradient(to bottom, ${
                themeMode === "light" ? "#f6f8fa" : "#0d1117"
              } 0%, ${
                themeMode === "light"
                  ? "rgba(246,248,250,0)"
                  : "rgba(13,17,23,0)"
              } 100%)`,
            }}
          />
        </header>

        {!hasMessages ? (
          /* ── New/empty chat: everything centered (input sits mid-screen) ── */
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-20">
            <NewChat />
            <div className="mt-10 w-full max-w-3xl">
              <ChatInput
                ref={chatInputRef}
                onSend={handleSend}
                isLoading={isLoading}
                onWebSearchChange={setWebSearchEnabled}
                needsScrollArrow={false}
                onScrollToBottom={scrollToBottom}
                onStop={handleStop}
                onFilePreview={handleFilePreview}
                onFileRemove={handleFileRemove}
                freeLimitReached={freeLimitReached}
                onAddKey={handleOpenModelsManager}
                onTakeGuide={handleOpenGuide}
              />
            </div>
          </div>
        ) : (
          /* ── Active chat: thread scrolls, input docks to the bottom ── */
          <>
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="chat-scrollbar flex-1 min-h-0 overflow-y-auto px-5 pb-44 pt-8 sm:px-4"
              style={{ height: "100%" }}
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                {error && (
                  <div className="flex items-center gap-3 rounded-md border border-[#f85149]/20 bg-[#f85149]/5 px-4 py-3">
                    <AlertCircle size={18} className="text-[#f85149] shrink-0" />
                    <span className="text-sm text-[#f85149]">{error}</span>
                  </div>
                )}

                {/* eslint-disable-next-line react-hooks/refs -- false positive: no ref is read during render here (all ref access is in handlers/effects) */}
                {messages.map((message) => {
                  const h = messageHandlers[message.id];
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      editing={editingId === message.id}
                      onEdit={h?.onEdit ?? (() => {})}
                      onCancel={h?.onCancel ?? (() => {})}
                      onSave={h?.onSave ?? (() => {})}
                      onRegenerate={h?.onRegenerate ?? (() => {})}
                      isLoading={isLoading}
                      isIncomplete={isIncomplete && message.id === lastAssistantId}
                      onContinue={handleContinue}
                      hasSources={h?.onShowSources ? true : false}
                      onShowSources={h?.onShowSources}
                      onOpenAttachment={h?.onOpenAttachment}
                    />
                  );
                })}
              </div>
            </div>

            <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
          style={{
            background: `linear-gradient(to top, ${
              themeMode === "light" ? "#f6f8fa" : "#0d1117"
            } 0%, ${
              themeMode === "light"
                ? "rgba(246, 248, 250, 0)"
                : "rgba(13, 17, 23, 0)"
            } 100%)`,
          }}
        />
        <div className="absolute bottom-0 left-0 right-0">
              <div className="mx-auto max-w-3xl px-4 pb-4">
                <ChatInput
                  ref={chatInputRef}
                  onSend={handleSend}
                  isLoading={isLoading}
                  onWebSearchChange={setWebSearchEnabled}
                  needsScrollArrow={hasMessages && isUserScrolledUp}
                  onScrollToBottom={scrollToBottom}
                  onStop={handleStop}
                  onFilePreview={handleFilePreview}
                  onFileRemove={handleFileRemove}
                  freeLimitReached={freeLimitReached}
                  onAddKey={handleOpenModelsManager}
                  onTakeGuide={handleOpenGuide}
                />
              </div>
            </div>
          </>
        )}
      </main>

      <FilePreviewPanel
        file={previewFile}
        sources={previewSources}
        isOpen={isPreviewOpen}
        onClose={closePreview}
      />
      </div>

      {showModelsManager && (
        <ModelsManager onClose={() => setShowModelsManager(false)} />
      )}

      {showGuide && <Guide onClose={() => setShowGuide(false)} />}
    </>
  );
}