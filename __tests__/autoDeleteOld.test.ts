import { describe, it, expect } from "vitest";
import { compressBytes, encryptBytes } from "@/lib/chatCrypto";

async function rawIdbPut(session: {
  id: string; title: string;
  messages: { id: number; role: "user" | "assistant"; content: string }[];
  createdAt: string; updatedAt: string; isPinned?: boolean;
}): Promise<void> {
  const json = JSON.stringify(session);
  const compressed = await compressBytes(new TextEncoder().encode(json));
  const encrypted = await encryptBytes(compressed);
  if (!encrypted) throw new Error("encrypt failed");
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("orcachat_chats", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put({ id: session.id, data: encrypted });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

describe("auto-delete old chats", () => {
  it("deletes chats older than 7 days, keeps recent", async () => {
    const now = new Date().toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
    await rawIdbPut({ id: "old_1", title: "Old", messages: [], createdAt: eightDaysAgo, updatedAt: eightDaysAgo });
    await rawIdbPut({ id: "new_1", title: "New", messages: [], createdAt: now, updatedAt: now });
    const mod = await import("@/lib/chatStorage");
    await mod.ensureChatsLoaded();
    expect(mod.getChatSession("old_1")).toBeNull();
    expect(mod.getChatSession("new_1")).not.toBeNull();
  });
});
