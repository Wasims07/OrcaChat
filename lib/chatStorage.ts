import {
  encryptBytes,
  decryptBytes,
  compressBytes,
  decompressBytes,
  decryptString,
} from "@/lib/chatCrypto";

export type MessageSource = {
  title: string;
  url: string;
  domain?: string;
  favicon?: string;
  snippet?: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Reference websites linked to an assistant reply. */
  sources?: MessageSource[];
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Last time the chat was opened/viewed by the user. Used for the 7-day
   *  auto-delete timer (falls back to `updatedAt` for older sessions). */
  lastOpenedAt?: string;
  isPinned?: boolean;
  isArchived?: boolean;
};

// =========================================
// IndexedDB configuration
// =========================================

const DB_NAME = "orcachat_chats";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const LEGACY_LOCALSTORAGE_KEY = "chat_sessions";
const CHAT_UPDATE_EVENT = "chat-updated";
const AUTO_DELETE_DAYS = 7;

// =========================================
// In-memory decrypted cache — the source of truth for all reads within a tab.
// IndexedDB is only read once (on hydration) and on cross-tab BroadcastChannel
// messages. Keeping reads synchronous from memory avoids making every consumer
// async while still writing encrypted + compressed data at rest.
// =========================================

let cache: ChatSession[] | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let dbInstance: IDBDatabase | null = null;

// =========================================
// IndexedDB helpers
// =========================================

function openChatDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      // Handle connection loss (e.g. browser clears storage)
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

// Write a single session record to IndexedDB (compressed + encrypted).
async function idbPut(session: ChatSession): Promise<void> {
  const json = JSON.stringify(session);
  const compressed = await compressBytes(new TextEncoder().encode(json));
  const encrypted = await encryptBytes(compressed);
  if (!encrypted) return;
  const db = await openChatDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ id: session.id, data: encrypted });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Delete a single session record from IndexedDB.
async function idbDelete(id: string): Promise<void> {
  const db = await openChatDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Read all session records from IndexedDB, decrypt + decompress each.
async function idbGetAll(): Promise<ChatSession[]> {
  const db = await openChatDB();
  const records: { id: string; data: Uint8Array }[] = await new Promise(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }
  );
  const sessions: ChatSession[] = [];
  for (const rec of records) {
    try {
      const decrypted = await decryptBytes(rec.data);
      if (!decrypted) continue;
      const decompressed = await decompressBytes(decrypted);
      const json = new TextDecoder().decode(decompressed);
      sessions.push(JSON.parse(json));
    } catch {
      // Corrupted record — skip it.
    }
  }
  return sessions;
}

// Clear all records from IndexedDB.
async function idbClear(): Promise<void> {
  const db = await openChatDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// =========================================
// One-time migration: old localStorage blob → IndexedDB
// =========================================

async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
  } catch { /* ignore */ }
  if (!raw) return;

  try {
    const decrypted = await decryptString(raw);
    const sessions: ChatSession[] = JSON.parse(decrypted || "[]");
    if (Array.isArray(sessions) && sessions.length > 0) {
      for (const s of sessions) {
        await idbPut(s);
      }
    }
  } catch {
    // Corrupted legacy blob — just discard it.
  }

  // Remove the old localStorage key regardless.
  try {
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
  } catch { /* ignore */ }
}

// =========================================
// 7-day auto-delete (professional expiry model).
//
// A chat lives for AUTO_DELETE_DAYS (7 days) measured from its LAST activity:
//   - "activity" = the last time it was opened (`lastOpenedAt`), or, for very
//     old sessions that predate that field, its last update (`updatedAt`).
//   - Opening/re-opening a chat resets the clock by stamping a fresh
//     `lastOpenedAt`, giving it 7 more days (see markChatOpened).
//   - Pinned chats are exempt and never expire.
//
// Expiry is enforced in TWO complementary ways:
//   1. On every sweep (app load, 6-hourly, tab-visible) expired chats are
//      PHYSICALLY deleted from IndexedDB (bytes removed, not just hidden).
//   2. On every read, any chat that has crossed its expiry boundary but has
//      not yet been swept is filtered out and a sweep is triggered. This
//      guarantees a stale chat never surfaces mid-session, even between
//      sweeps.
// =========================================

const MAX_AGE_MS = AUTO_DELETE_DAYS * 24 * 60 * 60 * 1000;

// Absolute expiry timestamp for a session (ms since epoch), or Infinity if it
// can never expire (pinned). Uses last-open when available, else last-update.
function sessionExpiresAt(s: ChatSession): number {
  if (s.isPinned) return Infinity;
  const lastActive = s.lastOpenedAt || s.updatedAt;
  const t = new Date(lastActive).getTime();
  return Number.isFinite(t) ? t + MAX_AGE_MS : Infinity;
}

function isSessionExpired(s: ChatSession, now = Date.now()): boolean {
  return now > sessionExpiresAt(s);
}

// Delete every expired (non-pinned) chat from IndexedDB and return what kept.
async function pruneStaleChats(sessions: ChatSession[]): Promise<ChatSession[]> {
  const now = Date.now();
  const kept: ChatSession[] = [];
  const staleIds: string[] = [];

  for (const s of sessions) {
    if (isSessionExpired(s, now)) {
      staleIds.push(s.id);
    } else {
      kept.push(s);
    }
  }

  if (staleIds.length > 0) {
    for (const id of staleIds) {
      await idbDelete(id);
    }
    console.log(`🗑️ chatStorage: auto-deleted ${staleIds.length} stale chat(s) (>${AUTO_DELETE_DAYS}d)`);
  }

  return kept;
}

// Best-effort: physically remove any expired chats from IndexedDB as soon as
// one is seen, so no stale bytes linger between sweeps.
function sweepIfNeeded(): void {
  if (cache === null) return;
  const hasStale = cache.some((s) => isSessionExpired(s));
  if (hasStale) void runBackgroundPrune();
}

// A read-visible view of the cache that never contains expired sessions.
function liveSessions(): ChatSession[] {
  if (cache === null) return [];
  const live = cache.filter((s) => !isSessionExpired(s));
  if (live.length !== cache.length) sweepIfNeeded();
  return live;
}

// =========================================
// Persistence: write entire cache to IndexedDB
// =========================================

async function persistToStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  const sessions = cache ?? [];
  try {
    for (const s of sessions) {
      await idbPut(s);
    }
  } catch (error) {
    console.error("❌ chatStorage: failed to persist chats to IndexedDB", error);
  }
}

// Queue a persistence write so concurrent updates don't race.
function schedulePersist(): void {
  persistenceQueue = persistenceQueue.then(persistToStorage, persistToStorage);
}

// =========================================
// Hydration: load from IndexedDB into memory
// =========================================

async function hydrate(): Promise<void> {
  if (typeof window === "undefined" || cache !== null) return;

  // One-time migration from old localStorage blob.
  await migrateFromLocalStorage();

  try {
    const sessions = await idbGetAll();
    // Auto-delete stale (unpinned, >7 days) chats.
    cache = await pruneStaleChats(sessions);
    // Persist back if any were pruned (so the deletions stick).
    if (cache.length !== sessions.length) {
      schedulePersist();
    }
  } catch (error) {
    console.error("❌ chatStorage: hydration from IndexedDB failed", error);
    cache = [];
  }
}

// Lazily start hydration on first touch. Returns immediately; callers that
// need the freshest data on mount should await `ensureHydrated()`.
function ensureHydrated(): Promise<void> {
  if (cache !== null) return Promise.resolve();
  return hydrate();
}

// Force a fresh read of IndexedDB (used on cross-tab BroadcastChannel msgs).
async function rehydrate(): Promise<void> {
  try {
    const sessions = await idbGetAll();
    cache = await pruneStaleChats(sessions);
  } catch {
    cache = [];
  }
  notifyChatUpdate();
}

// =========================================
// Cross-tab sync via BroadcastChannel
// =========================================

let syncChannel: BroadcastChannel | null = null;

if (typeof window !== "undefined") {
  try {
    syncChannel = new BroadcastChannel("orcachat-sync");
    syncChannel.onmessage = (e) => {
      if (e.data?.type === "chat-updated" && e.data.session) {
        // Fast path: receive the full session directly, no IndexedDB read needed.
        if (cache === null) cache = [];
        const idx = cache.findIndex((s) => s.id === e.data.session.id);
        if (idx !== -1) {
          cache[idx] = e.data.session;
        } else {
          cache.unshift(e.data.session);
        }
        notifyChatUpdate();
      } else if (e.data?.type === "chat-updated") {
        // Fallback: no session payload — rehydrate from IndexedDB.
        void rehydrate();
      }
    };
  } catch {
    // BroadcastChannel not supported — cross-tab sync degrades gracefully.
  }
}

// Notify the UI (sidebar, etc.) that chat data changed.
// Also posts to BroadcastChannel so OTHER tabs rehydrate.
export function notifyChatUpdate(session?: ChatSession): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_UPDATE_EVENT));
  try {
    syncChannel?.postMessage({ type: "chat-updated", session: session || null });
  } catch { /* ignore */ }
}

// =========================================
// Background 7-day auto-delete.
//
// Auto-deletion must work even when a device (especially mobile) keeps the
// tab open for days without a reload. Hydration already prunes on first
// load; this adds:
//   - a periodic background sweep, so stale chats are removed while the app
//     sits open/running, and
//   - a sweep whenever the tab becomes visible again (covers backgrounded
//     mobile tabs without firing anything on a hidden page).
// Both are resumable and never block: they re-read only non-pinned chats and
// delete exactly the expired ones. Duplicate/in-flight sweeps are coalesced.
// =========================================

let pruneTimer: ReturnType<typeof setInterval> | null = null;
let pruneInFlight: Promise<void> | null = null;

async function runBackgroundPrune(): Promise<void> {
  if (pruneInFlight) return pruneInFlight;
  pruneInFlight = (async () => {
    try {
      if (typeof window === "undefined" || cache === null) return;
      const kept = await pruneStaleChats(cache);
      // Only persist when something actually changed (a chat was removed).
      if (kept.length !== cache.length) {
        cache = kept;
        schedulePersist();
        notifyChatUpdate();
      }
    } catch {
      // Pruning is best-effort; never let it break the app.
    } finally {
      pruneInFlight = null;
    }
  })();
  return pruneInFlight;
}

function startBackgroundPruning(): void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    pruneTimer
  ) {
    return;
  }
  // Sweep every 6 hours while the app is open.
  pruneTimer = setInterval(() => {
    void runBackgroundPrune();
  }, 6 * 60 * 60 * 1000);
  // Sweep again the moment the tab becomes visible (covers devices that
  // suspend background tabs for days).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runBackgroundPrune();
  });
}

// Start the background pruner once the module loads in a browser. It only
// acts once the in-memory cache exists (i.e. after the user actually opens the
// app and hydration has run), so it never forces an early IndexedDB read or
// changes hydration timing.
if (typeof window !== "undefined") {
  startBackgroundPruning();
}

// =========================================
// Public API (unchanged signatures)
// =========================================

// Ensure the in-memory cache reflects the latest on-disk (encrypted) data.
// Returns a promise; call with await on components' mount effects.
export async function ensureChatsLoaded(): Promise<void> {
  await ensureHydrated();
}

// Get all chat sessions (from the in-memory decrypted cache).
// Expired chats are always filtered out and cleansed as soon as one appears.
export function getChatSessions(): ChatSession[] {
  if (cache === null) {
    // Trigger hydration in the background; return empty until it completes.
    void ensureHydrated();
    return [];
  }
  return liveSessions();
}

// Save a chat session
export function saveChatSession(session: ChatSession): void {
  if (typeof window === "undefined") return;
  if (cache === null) cache = [];
  const sessions = cache;
  const existingIndex = sessions.findIndex((s) => s.id === session.id);

  if (existingIndex !== -1) {
    sessions[existingIndex] = session;
  } else {
    sessions.unshift(session);
  }

  schedulePersist();
  notifyChatUpdate(session);
}

// Get a single chat session by ID
export function getChatSession(id: string): ChatSession | null {
  const sessions = getChatSessions();
  return sessions.find((s) => s.id === id) || null;
}

// Record that a chat was opened/viewed by the user. Resets its 7-day
// auto-delete timer so the chat lives 7 more days from when it was opened.
export function markChatOpened(id: string): void {
  if (typeof window === "undefined" || cache === null) return;
  const session = cache.find((s) => s.id === id);
  if (session) {
    session.lastOpenedAt = new Date().toISOString();
    schedulePersist();
    notifyChatUpdate();
  }
}

// Ensure writes wait for hydration so we never act on a stale (empty) cache
// before IndexedDB has loaded. Mutations that occur before hydration must
// hydrate first and then apply the change to the freshly-loaded data.
async function ensureCacheForMutation(): Promise<ChatSession[]> {
  if (cache === null) {
    await ensureHydrated();
  }
  return cache ?? [];
}

// Delete a chat session
export async function deleteChatSession(id: string): Promise<void> {
  await ensureCacheForMutation();
  const idx = cache!.findIndex((s) => s.id === id);
  if (idx === -1) {
    // Not in memory — still remove from IndexedDB directly.
    void idbDelete(id).catch((err) =>
      console.error("❌ chatStorage: failed to delete chat from IndexedDB", err)
    );
    notifyChatUpdate();
    return;
  }
  cache = cache!.filter((s) => s.id !== id);
  // Delete from IndexedDB directly (faster than rewriting the whole store).
  await idbDelete(id).catch((err) =>
    console.error("❌ chatStorage: failed to delete chat from IndexedDB", err)
  );
  notifyChatUpdate();
}

// Update chat title (Rename) - keeps the original time/position
export async function updateChatTitle(id: string, title: string): Promise<void> {
  await ensureCacheForMutation();
  const session = cache!.find((s) => s.id === id);
  if (session) {
    session.title = title;
    schedulePersist();
    notifyChatUpdate();
  }
}

// Pin a chat
export async function togglePinChat(id: string): Promise<void> {
  await ensureCacheForMutation();
  const session = cache!.find((s) => s.id === id);
  if (session) {
    session.isPinned = !session.isPinned;
    session.updatedAt = new Date().toISOString();
    schedulePersist();
    notifyChatUpdate();
  }
}

// Archive a chat
export async function toggleArchiveChat(id: string): Promise<void> {
  await ensureCacheForMutation();
  const session = cache!.find((s) => s.id === id);
  if (session) {
    session.isArchived = !session.isArchived;
    session.updatedAt = new Date().toISOString();
    schedulePersist();
    notifyChatUpdate();
  }
}

// Get archived chats
export function getArchivedChats(): ChatSession[] {
  const sessions = getChatSessions();
  return sessions.filter((s) => s.isArchived === true);
}

// Get pinned chats
export function getPinnedChats(): ChatSession[] {
  const sessions = getChatSessions();
  return sessions.filter((s) => s.isPinned === true);
}

// Generate a title from the first message
export function generateTitle(messages: ChatMessage[]): string {
  if (messages.length === 0) return "New Chat";
  const firstMessage = messages[0].content;
  const lines = firstMessage.split("\n");
  const firstLine = lines[0] || firstMessage;
  return firstLine.length > 30 ? firstLine.substring(0, 30) + "..." : firstLine;
}

// Create a new chat session ID
export function createChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

// Check if a chat has messages
export function hasMessages(chatId: string): boolean {
  const session = getChatSession(chatId);
  return session ? session.messages.length > 0 : false;
}

// Clear all chat sessions — wipes IndexedDB completely.
export function clearAllChats(): void {
  if (typeof window === "undefined") return;
  cache = [];
  void idbClear().catch((err) =>
    console.error("❌ chatStorage: failed to clear IndexedDB", err)
  );
  notifyChatUpdate();
}

// Get chat count
export function getChatCount(): number {
  const sessions = getChatSessions();
  return sessions.length;
}

// Export chat as JSON
export function exportChatToJSON(id: string): string | null {
  const session = getChatSession(id);
  if (!session) return null;
  return JSON.stringify(session, null, 2);
}
