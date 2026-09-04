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

describe("auto-delete boundary", () => {
  it("keeps chats at exactly 6 days old", async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString();
    const now = new Date().toISOString();
    await rawIdbPut({ id: "six_day", title: "Six Days", messages: [], createdAt: sixDaysAgo, updatedAt: sixDaysAgo });
    await rawIdbPut({ id: "six_day_new", title: "New", messages: [], createdAt: now, updatedAt: now });
    const mod = await import("@/lib/chatStorage");
    await mod.ensureChatsLoaded();
    expect(mod.getChatSession("six_day")).not.toBeNull();
    expect(mod.getChatSession("six_day_new")).not.toBeNull();
  });
});
