import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  MAX_REQUEST_BODY_BYTES,
  getClientToken,
  sanitizeErrorMessage,
  sanitizeUploadedHtml,
} from "@/lib/security";
import { RedisSlidingWindowRateLimiter } from "@/lib/redisRateLimiter";

export const runtime = "nodejs";

// Preview conversion can be resource-heavy — throttle it gently.
const limiter = new RedisSlidingWindowRateLimiter(20, 60_000, "preview");

// Validate a file's leading bytes ("magic") match the extension it claims so a
// caller can't disguise arbitrary file content as an Office document.
function magicMatches(buf: Buffer, ext: string): boolean {
  if (ext === "docx" || ext === "xlsx") {
    // Office Open XML files are ZIP archives.
    return buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  }
  if (ext === "xls") {
    // Legacy OLE2 compound document signature.
    return buf
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  return true;
}

// Convert Office documents (docx / xlsx / xls) into HTML so the
// file preview panel can render them as their native file type,
// or (mode: "text") into plain text so the AI can read the file.
export async function POST(req: NextRequest) {
  try {
    const rl = await limiter.check(getClientToken(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json(
        { error: "File is too large." },
        { status: 413 }
      );
    }
    let body: { fileName?: unknown; file?: unknown; mode?: unknown; sheetIndex?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const fileName: string = typeof body?.fileName === "string" ? body.fileName : "";
    const fileBase64: string = typeof body?.file === "string" ? body.file : "";
    const mode: string = typeof body?.mode === "string" ? body.mode : "html";

    if (!fileBase64) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const buf = Buffer.from(fileBase64, "base64");

    if (buf.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    if (!magicMatches(buf, ext)) {
      return NextResponse.json(
        { error: "File content does not match its type" },
        { status: 400 }
      );
    }

    // Word documents (.docx)
    if (ext === "docx") {
      if (mode === "text") {
        const result = await mammoth.extractRawText({ buffer: buf });
        return NextResponse.json({ format: "text", text: result.value });
      }
      const result = await mammoth.convertToHtml({ buffer: buf });
      // HTML rendering uses dangerouslySetInnerHTML — sanitize first.
      return NextResponse.json({ format: "html", html: sanitizeUploadedHtml(result.value) });
    }

    // Legacy Word (.doc) - mammoth only supports .docx
    if (ext === "doc") {
      return NextResponse.json({
        format: "unsupported",
        message:
          "Legacy .doc files can't be previewed. Open in Word or save the file as .docx.",
      });
    }

    // Excel workbooks (.xlsx / .xls)
    if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX.read(buf, { type: "buffer" });
      const sheetNames: string[] = workbook.SheetNames;

      if (sheetNames.length === 0) {
        return NextResponse.json({
          format: "unsupported",
          message: "This workbook has no sheets to display.",
        });
      }

      if (mode === "text") {
        const parts = sheetNames.map((name) => {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(
            workbook.Sheets[name],
            { header: 1 }
          );
          const cellLines = rows
            .map((row) => row.join("\t"))
            .join("\n");
          return `Sheet: ${name}\n${cellLines}`;
        });
        return NextResponse.json({ format: "text", text: parts.join("\n\n") });
      }

      const requestedIndex =
        typeof body?.sheetIndex === "number" ? body.sheetIndex : 0;
      const activeIndex = Math.max(
        0,
        Math.min(requestedIndex, sheetNames.length - 1)
      );
      const activeSheet = sheetNames[activeIndex];
      const html = XLSX.utils.sheet_to_html(workbook.Sheets[activeSheet], {
        header: "",
      });

      return NextResponse.json({
        format: "spreadsheet",
        html: sanitizeUploadedHtml(html),
        sheetNames,
        activeSheet,
      });
    }

    return NextResponse.json({ format: "unsupported" });
  } catch (error) {
    console.error("❌ Preview conversion error:", error);
    return NextResponse.json(
      {
        error:
          sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error)
          ) || "Failed to generate preview",
      },
      { status: 500 }
    );
  }
}