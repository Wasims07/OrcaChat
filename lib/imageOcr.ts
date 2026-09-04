// =========================================
// Client-side OCR for uploaded images
//
// Runs Tesseract.js in the browser so the text inside an image becomes plain
// text that the chat API can forward to ANY model (vision-capable or not).
//
// tesseract.js is very heavy (~MB of worker + language data), so it is loaded
// dynamically ONLY when an image is actually OCR'd instead of on page load.
// =========================================
type WorkerLike = {
  recognize: (file: File) => Promise<{ data: { text: string } }>;
};

let ocrWorkerPromise: Promise<WorkerLike> | null = null;

function getWorker(): Promise<WorkerLike> {
  if (!ocrWorkerPromise) {
    // Lazy-load the heavy library on first real OCR use, then reuse a single
    // worker across calls (English by default).
    ocrWorkerPromise = import("tesseract.js").then((mod) =>
      mod.createWorker("eng")
    );
  }
  return ocrWorkerPromise;
}

export async function ocrImageText(file: File): Promise<string> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(file);
    return (data.text || "").trim();
  } catch (error) {
    console.error("❌ OCR failed:", error);
    return "";
  }
}