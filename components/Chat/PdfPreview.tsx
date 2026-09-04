"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";

// Lazily-loaded PDF.js renderer. The heavy pdfjs-dist module + worker are only
// pulled in when a PDF preview is actually opened. Mimics Claude AI's preview:
// the page is fitted to the panel width, vertically centered, with simple
// prev/next navigation and no zoom controls.
let pdfjs: typeof import("pdfjs-dist") | null = null;
let workerReady: Promise<void> | null = null;

async function ensurePdfjs() {
  if (!workerReady) {
    workerReady = (async () => {
      const mod = await import("pdfjs-dist");
      pdfjs = mod;
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
    })();
  }
  await workerReady;
  return pdfjs!;
}

export default function PdfPreview({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const loadedFileRef = useRef<File | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Load the document once, then render the requested page (fit to width).
  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const loadAndRender = async (want: number, forceLoad: boolean) => {
      try {
        if (forceLoad || !docRef.current) {
          // Tear down any previously loaded document before loading the new one.
          if (docRef.current) {
            loadingTaskRef.current?.destroy();
            loadingTaskRef.current = null;
            docRef.current = null;
          }
          const lib = await ensurePdfjs();
          if (cancelled) return;
          const data = await file.arrayBuffer();
          if (cancelled) return;
          const task = lib.getDocument({ data });
          loadingTaskRef.current = task;
          const d = await task.promise;
          if (cancelled) return;
          docRef.current = d;
          if (!cancelled) setNumPages(d.numPages);
          loadedFileRef.current = file;
        }
        const doc = docRef.current!;
        const pdfPage = await doc.getPage(want);
        if (cancelled) return;

        // Fit to available width, leaving a little gutter.
        const hostEl = hostRef.current;
        const avail = hostEl ? Math.max(240, hostEl.clientWidth - 48) : 640;
        const base = pdfPage.getViewport({ scale: 1 }).width;
        const viewport = pdfPage.getViewport({ scale: avail / base });

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) {
          if (!cancelled) setError("Canvas is not supported");
          return;
        }

        const ratio = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = viewport.width * ratio;
        canvas.height = viewport.height * ratio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        if (renderTask) renderTask.cancel();
        const t = pdfPage.render({
          canvas,
          viewport: pdfPage.getViewport({ scale: (avail / base) * ratio }),
        });
        renderTask = t;
        await t.promise;
      } catch (e) {
        const err = (e ?? {}) as { name?: string; message?: string };
        // RenderingCancelledException is expected when navigating pages quickly.
        if (err.name === "RenderingCancelledException" && cancelled) return;
        console.error("[PdfPreview] render failed:", e);
        if (!cancelled) setError(err.message || "Failed to render PDF");
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    // Resetting `ready` when the page/file changes is intentional and sync;
    // the actual load happens async below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(false);
    const forceLoad = loadedFileRef.current !== file;
    loadAndRender(page, forceLoad);
    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [file, page]);

  useEffect(() => {
    return () => {
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, []);

  const go = (next: number) => {
    const clamped = Math.min(numPages, Math.max(1, next));
    if (clamped !== page) setPage(clamped);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {numPages > 1 && (
        <div className="flex flex-shrink-0 items-center justify-center gap-2 border-b border-[#30363d] px-3 py-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => go(page - 1)}
            className="rounded-md p-1 text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9] disabled:opacity-30"
            title="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-12 text-center text-[11px] text-[#8b949e]">
            {page} / {numPages}
          </span>
          <button
            type="button"
            disabled={page >= numPages}
            onClick={() => go(page + 1)}
            className="rounded-md p-1 text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9] disabled:opacity-30"
            title="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      <div
        ref={hostRef}
        className="chat-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#161b22] p-6"
      >
        {error ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[#f85149]">
            {error}
          </div>
        ) : (
          <div className="relative">
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[#8b949e]">
                <Loader2 size={16} className="animate-spin text-[#1f6feb]" />
                <span>Loading PDF...</span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="mx-auto block shadow-2xl"
            />
          </div>
        )}
      </div>
    </div>
  );
}