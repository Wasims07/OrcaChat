// Stream guard against "empty responses": some providers return 200 with a
// stream that contains ZERO content tokens (throttled/free endpoints, content
// safety filters, or a mangled model response). We peek the (already
// normalized) OpenAI-shaped SSE stream until the first content delta arrives,
// the stream ends, or a generous deadline passes.
//
// Failover ONLY happens when the stream actually ENDS with zero content —
// that is the true "empty reply" case and it is detected quickly, because a
// throttled endpoint sends its (tiny) complete response and closes within a
// second or two. A slow-but-working model keeps its connection open for many
// seconds before its first token; those streams are handed back untouched so
// we never kill a valid model just because it is slow (which would cascade
// into "all providers failed" 502s on the free tier).

export async function ensureStreamContent(
  readable: ReadableStream<Uint8Array>,
  maxWaitMs = 20000
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  const buffered: Uint8Array[] = [];
  let sawContent = false;
  let endedEmpty = false;
  let window = "";
  const deadline = Date.now() + maxWaitMs;

  try {
    while (!sawContent && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) {
        // Stream closed with no content token at all → definitive empty reply.
        endedEmpty = true;
        break;
      }
      buffered.push(value);
      window += decoder.decode(value, { stream: true });
      // Only the SSE data lines matter; look for any non-empty content delta.
      for (const line of window.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data: ")) continue;
        const data = t.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const c = parsed?.choices?.[0]?.delta?.content;
          if (typeof c === "string" && c.length > 0) {
            sawContent = true;
            break;
          }
        } catch {
          // not JSON — keep scanning
        }
      }
    }
  } catch {
    return null;
  }

  if (endedEmpty) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    return null;
  }

  // Replay everything buffered so nothing is lost, then stream the rest of
  // the body from the same reader. This also covers the deadline-hit case:
  // the stream is still open and may just be slow to its first token.
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // stream interrupted — close cleanly
      }
      controller.close();
    },
    cancel() {
      try {
        reader.cancel();
      } catch {
        // ignore
      }
    },
  });
}