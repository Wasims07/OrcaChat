// =========================================
// At-rest encryption for chat sessions.
//
// Uses Web Crypto AES-GCM (256-bit) to encrypt chat data before it is written
// to IndexedDB, and decrypts it when read. Protects the stored chats from
// casual inspection / theft of the raw storage file.
//
// Binary helpers (encryptBytes / decryptBytes + gzip) are used by chatStorage
// for IndexedDB. String helpers (encryptString / decryptString) remain for
// modelStore which stores small encrypted JSON strings in localStorage.
//
// IMPORTANT (honest limitation): the encryption key lives in the browser
// (this is required so chats remain readable after a reload without a server).
// It does NOT protect against malware that can read the page's JS memory, and
// it does NOT encrypt data in transit (that is TLS). It is a defense-in-depth
// layer for data at rest on the local machine.
// =========================================

const KEY_STORAGE = "orcachat_enc_key_v1";
const ENC_VERSION = "e1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// base64 helpers that work in the browser (no Buffer dependency). Process in
// chunks so string concatenation stays efficient for large payloads.
const B64_CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const end = Math.min(i + B64_CHUNK, bytes.length);
    binary += String.fromCharCode(...Array.prototype.slice.call(bytes, i, end));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Derive/load the AES key. Persisted in localStorage so chats remain readable
// across page reloads on the same machine/browser.
async function getOrCreateKey(): Promise<CryptoKey | null> {
  try {
    let raw: Uint8Array<ArrayBuffer> | null = null;
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored) {
      raw = base64ToBytes(stored);
    }
    if (!raw || raw.length !== 32) {
      raw = crypto.getRandomValues(new Uint8Array(32));
      localStorage.setItem(KEY_STORAGE, bytesToBase64(raw));
    }
    return await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    console.error("❌ chatCrypto: failed to load/create encryption key", error);
    return null;
  }
}

export type EncryptedPayload = {
  v: string;
  iv: string;
  data: string;
};

export function isEncrypted(value: unknown): value is EncryptedPayload {
  return (
    !!value &&
    typeof value === "object" &&
    (value as EncryptedPayload).v === ENC_VERSION &&
    typeof (value as EncryptedPayload).iv === "string" &&
    typeof (value as EncryptedPayload).data === "string"
  );
}

export async function encryptString(plaintext: string): Promise<string | null> {
  const key = await getOrCreateKey();
  if (!key) return JSON.stringify(plaintext);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      textEncoder.encode(plaintext)
    );
    const payload: EncryptedPayload = {
      v: ENC_VERSION,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(ciphertext)),
    };
    return JSON.stringify(payload);
  } catch (error) {
    console.error("❌ chatCrypto: encrypt failed", error);
    return JSON.stringify(plaintext);
  }
}

export async function decryptString(
  serialized: string
): Promise<string | null> {
  try {
    const parsed = JSON.parse(serialized);
    if (!isEncrypted(parsed)) {
      // Legacy plaintext (written before encryption was added) — return as-is.
      return serialized;
    }
    const key = await getOrCreateKey();
    if (!key) return null;
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
      key,
      base64ToBytes(parsed.data)
    );
    return textDecoder.decode(plainBuffer);
  } catch {
    // Not a JSON payload we produced -> legacy plaintext.
    return serialized;
  }
}

// In-memory cache of the session index (names + flags only) so the sidebar
// does not have to decrypt full message bodies on every render.
export function isCryptoAvailable(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof crypto !== "undefined" &&
      !!crypto.subtle
    );
  } catch {
    return false;
  }
}

// =========================================
// Compression helpers (gzip via CompressionStream)
// =========================================

async function pipeStreams(
  source: ReadableStream<Uint8Array>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: TransformStream<any, Uint8Array>
): Promise<Uint8Array> {
  const reader = source.pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

export async function compressBytes(
  data: Uint8Array
): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return pipeStreams(stream, new CompressionStream("gzip"));
}

export async function decompressBytes(
  data: Uint8Array
): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return pipeStreams(stream, new DecompressionStream("gzip"));
}

// =========================================
// Binary AES-GCM helpers for IndexedDB storage.
//
// Wire format: [ 0x01 (version) | iv(12 bytes) | ciphertext ]
// Stored as a raw Uint8Array — no base64 overhead.
// =========================================

const BIN_ENC_VERSION = 0x01;

export async function encryptBytes(
  plaintext: Uint8Array
): Promise<Uint8Array | null> {
  const key = await getOrCreateKey();
  if (!key) return null;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext as BufferSource
    );
    // version(1) + iv(12) + ciphertext
    const result = new Uint8Array(1 + 12 + ciphertext.byteLength);
    result[0] = BIN_ENC_VERSION;
    result.set(iv, 1);
    result.set(new Uint8Array(ciphertext), 13);
    return result;
  } catch (error) {
    console.error("❌ chatCrypto: encryptBytes failed", error);
    return null;
  }
}

export async function decryptBytes(
  data: Uint8Array
): Promise<Uint8Array | null> {
  try {
    if (data.length < 14 || data[0] !== BIN_ENC_VERSION) {
      // Not our format — return null so caller can try legacy path.
      return null;
    }
    const iv = data.slice(1, 13);
    const ciphertext = data.slice(13);
    const key = await getOrCreateKey();
    if (!key) return null;
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new Uint8Array(plainBuffer);
  } catch {
    return null;
  }
}
