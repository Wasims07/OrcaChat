import { describe, it, expect } from "vitest";

// =========================================
// Crypto tests
// =========================================

describe("chatCrypto", () => {
  it("compress + decompress round-trips", async () => {
    const { compressBytes, decompressBytes } = await import("@/lib/chatCrypto");
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const input = enc.encode("Hello OrcaChat! ".repeat(50));
    const compressed = await compressBytes(input);
    expect(compressed.length).toBeLessThan(input.length);
    const decompressed = await decompressBytes(compressed);
    expect(dec.decode(decompressed)).toBe(dec.decode(input));
  });

  it("encrypt + decrypt bytes round-trips", async () => {
    const { encryptBytes, decryptBytes } = await import("@/lib/chatCrypto");
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const plaintext = enc.encode("secret data");
    const encrypted = await encryptBytes(plaintext);
    expect(encrypted).not.toBeNull();
    const decrypted = await decryptBytes(encrypted!);
    expect(dec.decode(decrypted!)).toBe("secret data");
  });

  it("decryptBytes returns null for bad data", async () => {
    const { decryptBytes } = await import("@/lib/chatCrypto");
    const result = await decryptBytes(new Uint8Array([0, 1, 2]));
    expect(result).toBeNull();
  });

  it("encryptString + decryptString round-trips", async () => {
    const { encryptString, decryptString } = await import("@/lib/chatCrypto");
    const enc = await encryptString("hello");
    expect(enc).not.toBeNull();
    const dec = await decryptString(enc!);
    expect(dec).toBe("hello");
  });
});

// =========================================
// CRUD tests
// =========================================

describe("chatStorage CRUD", () => {
  it("saves and retrieves a chat session", async () => {
    const mod = await import("@/lib/chatStorage");
    const now = new Date().toISOString();
    mod.saveChatSession({ id: "crud_save_1", title: "My Chat", messages: [{ id: 1, role: "user", content: "hi" }], createdAt: now, updatedAt: now });
    const found = mod.getChatSession("crud_save_1");
    expect(found).not.toBeNull();
    expect(found!.title).toBe("My Chat");
  });

  it("updates an existing session on re-save", async () => {
    const mod = await import("@/lib/chatStorage");
    const now = new Date().toISOString();
    const base = { id: "crud_upd_1", title: "Original", messages: [{ id: 1, role: "user" as const, content: "hi" }], createdAt: now, updatedAt: now };
    mod.saveChatSession(base);
    mod.saveChatSession({ ...base, title: "Updated" });
    expect(mod.getChatSession("crud_upd_1")!.title).toBe("Updated");
  });

  it("deleteChatSession removes single session", async () => {
    const mod = await import("@/lib/chatStorage");
    const now = new Date().toISOString();
    mod.saveChatSession({ id: "crud_del_a", title: "A", messages: [], createdAt: now, updatedAt: now });
    mod.saveChatSession({ id: "crud_del_b", title: "B", messages: [], createdAt: now, updatedAt: now });
    mod.deleteChatSession("crud_del_a");
    expect(mod.getChatSession("crud_del_a")).toBeNull();
    expect(mod.getChatSession("crud_del_b")).not.toBeNull();
  });

  it("togglePinChat works", async () => {
    const mod = await import("@/lib/chatStorage");
    const now = new Date().toISOString();
    mod.saveChatSession({ id: "crud_pin_1", title: "P", messages: [], createdAt: now, updatedAt: now, isPinned: false });
    mod.togglePinChat("crud_pin_1");
    expect(mod.getChatSession("crud_pin_1")!.isPinned).toBe(true);
    mod.togglePinChat("crud_pin_1");
    expect(mod.getChatSession("crud_pin_1")!.isPinned).toBe(false);
  });
});

// =========================================
// Utilities
// =========================================

describe("utilities", () => {
  it("generateTitle truncates long messages", async () => {
    const { generateTitle } = await import("@/lib/chatStorage");
    const title = generateTitle([{ id: 1, role: "user", content: "a".repeat(50) }]);
    expect(title.length).toBeLessThanOrEqual(33);
  });

  it("generateTitle returns New Chat for empty", async () => {
    const { generateTitle } = await import("@/lib/chatStorage");
    expect(generateTitle([])).toBe("New Chat");
  });
});
