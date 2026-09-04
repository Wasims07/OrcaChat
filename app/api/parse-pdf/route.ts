import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import {
  MAX_REQUEST_BODY_BYTES,
  getClientToken,
  sanitizeErrorMessage,
} from "@/lib/security";
import { RedisSlidingWindowRateLimiter } from "@/lib/redisRateLimiter";

export const runtime = "nodejs";

// pdf-parse v1 exports a single callable function (module.exports = Pdf) that
// takes a Buffer and resolves to { text, numpages, info }. We load it with
// createRequire against THIS file so it always resolves to the project-local
// v1.1.1 under src/node_modules — never to a differently-typed build hoisted
// higher in node_modules (which would break the runtime and the type checks).
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (
  data: Buffer
) => Promise<{
  text?: string;
  numpages?: number;
  info?: Record<string, unknown>;
}>;

// PDF parsing is resource-heavy — throttle it gently.
const limiter = new RedisSlidingWindowRateLimiter(20, 60_000, "parse-pdf");

// PDF files must begin with a PDF header (%PDF-) within the first 1024 bytes
// (the spec permits leading whitespace before the header).
function isPdf(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("latin1");
  return head.includes("%PDF-");
}

export async function POST(req: NextRequest) {
  try {
    const rl = await limiter.check(getClientToken(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          },
        }
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json(
        { error: "File is too large." },
        { status: 413 }
      );
    }
    let body: { file?: unknown; fileName?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }
    const { file, fileName } = body;

    if (typeof file !== "string" || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "File and fileName are required" },
        { status: 400 }
      );
    }

    console.log(`📄 Parsing PDF: ${fileName}`);

    try {
      const buffer = Buffer.from(file, "base64");
      if (buffer.length === 0) {
        return NextResponse.json({ error: "File is empty" }, { status: 400 });
      }
      if (!isPdf(buffer)) {
        return NextResponse.json(
          { error: "Uploaded file is not a valid PDF" },
          { status: 400 }
        );
      }

      const data = await pdfParse(buffer);
      const text = data?.text || "";
      const pages = data?.numpages || 0;

      if (!text || text.trim().length === 0) {
        return NextResponse.json({
          text: "",
          message:
            "No text content found in PDF. The PDF may be scanned or image-based.",
          pages,
        });
      }

      return NextResponse.json({ text, pages, info: data?.info || {} });
    } catch (pdfError) {
      console.error("❌ PDF Parse Error:", pdfError);
      return NextResponse.json(
        {
          error:
            sanitizeErrorMessage(
              pdfError instanceof Error ? pdfError.message : String(pdfError)
            ) || "Failed to parse PDF",
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("❌ Route Error:", error);
    return NextResponse.json(
      {
        error:
          sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error)
          ) || "Internal server error",
      },
      { status: 500 }
    );
  }
}
