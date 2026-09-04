// Client-side free-tier quota for users who haven't added their own model.
// Users without a custom model get FREE_TIER_LIMIT free sends per CHAT, backed
// by the shared OpenRouter key. Every new chat starts fresh with a full budget;
// within a chat, once the budget is used, we ask the user to add their own
// model (or follow the Guide). Users who add their own model are unlimited and
// skip this quota. Data is stored ONLY in the browser's localStorage.

const STORAGE_KEY = "orcachat_free_tier";

// Free-send budget per chat session for the free tier.
export const FREE_TIER_LIMIT = 10;

// Maps chat id -> number of free sends already used in that chat.
type FreeTierMap = Record<string, number>;

// In-memory cache so we don't JSON.parse localStorage on every call.
let cachedMap: FreeTierMap | null = null;

function loadMap(): FreeTierMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    return parsed as FreeTierMap;
  } catch {
    return {};
  }
}

function readMap(): FreeTierMap {
  if (cachedMap) return cachedMap;
  cachedMap = loadMap();
  return cachedMap;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedMap || {}));
  } catch {
    // ignore quota / availability errors
  }
}

// Keep the cache in sync when another tab updates the storage.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) cachedMap = loadMap();
  });
}

// Current usage for a specific chat. A fresh chat id always has a full budget.
export function getFreeTierUsage(
  chatId: string
): { used: number; remaining: number } {
  const used = readMap()[chatId] || 0;
  return {
    used,
    remaining: Math.max(0, FREE_TIER_LIMIT - used),
  };
}

// Claim one free send for the given chat. Returns whether it was allowed and
// the updated remaining budget. Call this BEFORE sending while the user is on
// the free tier (no custom model selected). A new chat id starts over at 10.
export function consumeFreeTierChat(
  chatId: string
): { allowed: boolean; remaining: number } {
  const map = readMap();
  const used = map[chatId] || 0;
  if (used >= FREE_TIER_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  const next = used + 1;
  map[chatId] = next;
  persist();
  return { allowed: true, remaining: Math.max(0, FREE_TIER_LIMIT - next) };
}

// Reset the free-tier usage for one chat, or for every chat when omitted.
export function resetFreeTierUsage(chatId?: string): void {
  if (typeof window === "undefined") return;
  const map = readMap();
  if (chatId) delete map[chatId];
  else Object.keys(map).forEach((k) => delete map[k]);
  persist();
}