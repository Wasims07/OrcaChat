// =========================================
// Encrypted server-side audit log (metadata only).
//
// Records non-sensitive metadata about each /api/chat request (timestamp,
// model, status, latency, token estimate) — NEVER the message content, and
// NEVER any user prompt text. The log is encrypted at rest with AES-256-GCM
// using Node's crypto.
//
// The encryption key is read from the AUDIT_LOG_KEY env var. If it is not set,
// the log is disabled (no records written) so we fail closed by default.
// =========================================

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export type AuditRecord = {
  ts: string;
  status: "success" | "error" | "rate_limited";
  model: string;
  latencyMs: number;
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
};

const ENV_KEY = process.env.AUDIT_LOG_KEY || "";
const LOG_DIR = process.env.AUDIT_LOG_DIR || "";

function isEnabled(): boolean {
  return ENV_KEY.length >= 32; // require a >=32-char key to enable
}

function deriveKey(secret: string): Buffer {
  // Derive a fixed 32-byte key from the secret so we can decrypt later.
  return createHash("sha256").update(secret).digest();
}

function ensureLogDir(): string | null {
  if (!LOG_DIR) return null;
  return LOG_DIR;
}

/**
 * Encrypt and append one audit record to today's log file.
 * Records contain metadata only — never message content.
 * Async so it never blocks the request/event loop.
 */
export function writeAuditRecord(record: AuditRecord): void {
  if (!isEnabled()) return; // fail closed when no key is configured

  const dir = ensureLogDir();
  if (!dir) return;

  const key = deriveKey(ENV_KEY);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(record);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // File format: [iv(12)][authTag(16)][ciphertext]
  const payload = Buffer.concat([iv, tag, encrypted]);

  // Fire-and-forget async write so the hot path is never blocked.
  (async () => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const file = path.join(dir, `chat-audit-${date}.enc`);
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(file, payload);
    } catch (error) {
      console.error("❌ auditLog: failed to write record", error);
    }
  })();
}
