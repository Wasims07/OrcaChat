import "fake-indexeddb/auto";

// Mock localStorage
const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};

// Mock window with EventTarget capabilities (chatStorage uses window.dispatchEvent)
if (typeof globalThis.window === "undefined") {
  const target = new EventTarget();
  const windowMock = {
    ...globalThis,
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
    addEventListener: (t: string, h: EventListener) => target.addEventListener(t, h),
    removeEventListener: (t: string, h: EventListener) => target.removeEventListener(t, h),
  };
  (globalThis as unknown as { window: Window & typeof globalThis }).window =
    windowMock as unknown as Window & typeof globalThis;
}

// Mock BroadcastChannel
if (typeof globalThis.BroadcastChannel === "undefined") {
  (globalThis as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
    class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      postMessage() {}
      close() {}
    } as unknown as typeof BroadcastChannel;
}
