import { describe, it, expect } from "vitest";
import { ensureStreamContent } from "@/lib/streamGuard";

const enc = new TextEncoder();

// Helper: turn raw SSE text into a ByteStream. Chunking is arbitrary to mimic
// real network fragmentation (a data line can span multiple chunks).
function sseStream(sse: string, chunkSize = 16): ReadableStream<Uint8Array> {
  const bytes = enc.encode(sse);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      while (i < bytes.length) {
        controller.enqueue(bytes.subarray(i, i + chunkSize));
        i += chunkSize;
      }
      controller.close();
    },
  });
}

const doneToken = `data: [DONE]\n\n`;

describe("ensureStreamContent", () => {
  it("returns null when the stream ends with no content (throttled 200)", async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
      doneToken;
    const guarded = await ensureStreamContent(sseStream(sse), 1500);
    expect(guarded).toBeNull();
  });

  it("replays buffered bytes when the first chunk contains content", async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n` +
      doneToken;
    const guarded = await ensureStreamContent(sseStream(sse), 1500);
    expect(guarded).not.toBeNull();
    const out = await new Response(guarded!).text();
    // Full original SSE must arrive intact (nothing dropped/reordered).
    expect(out).toBe(sse);
  });

  it("keeps streaming content split across many small chunks", async () => {
    let sse = "";
    for (let i = 0; i < 50; i++) {
      sse += `data: ${JSON.stringify({ choices: [{ delta: { content: `t${i} ` } }] })}\n\n`;
    }
    sse += doneToken;
    const guarded = await ensureStreamContent(sseStream(sse, 7), 1500);
    expect(guarded).not.toBeNull();
    const out = await new Response(guarded!).text();
    expect(out).toBe(sse);
  });

  it("returns null when the reader errors before any content", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("network reset"));
      },
    });
    const guarded = await ensureStreamContent(broken, 1500);
    expect(guarded).toBeNull();
  });

  it("does NOT fail over a slow-but-still-open stream (late first token)", async () => {
    // Free models routinely take several seconds to emit their first token.
    // A stream that is OPEN but quiet past the wait deadline must be handed
    // back, not cancelled — otherwise every slow model fails in cascade and
    // the whole request 502s.
    const slow = new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((r) => setTimeout(r, 120));
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "late" } }] })}\n\n`
          )
        );
        controller.enqueue(enc.encode(doneToken));
        controller.close();
      },
    });
    const guarded = await ensureStreamContent(slow, 50); // deadline < first token
    expect(guarded).not.toBeNull();
    const out = await new Response(guarded!).text();
    expect(out).toContain("late");
  });
});