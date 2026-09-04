const NAME_KEY = "orcachat_user_name";
const THEME_KEY = "orcachat_theme";
const CONSENT_KEY = "orcachat_privacy_consent";
const NOTICE_SEEN_KEY = "orcachat_privacy_notice_seen";
export const PROFILE_UPDATED_EVENT = "orcachat-profile-updated";
export const THEME_UPDATED_EVENT = "orcachat-theme-updated";
export const CONSENT_UPDATED_EVENT = "orcachat-consent-updated";

// The default display name used when the user has not set a real name.
const DEFAULT_NAME = "User";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function getUserName(): string {
  const name = safeGet(NAME_KEY);
  return name && name.trim() ? name.trim() : DEFAULT_NAME;
}

export function setUserName(name: string): void {
  const clean = name.trim() || DEFAULT_NAME;
  safeSet(NAME_KEY, clean);
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}

export type Theme = "dark" | "light";

export function getTheme(): Theme {
  const theme = safeGet(THEME_KEY);
  return theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  safeSet(THEME_KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_UPDATED_EVENT));
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

// =========================================
// Privacy consent (easily-implementable GDPR win)
//
// The app sets no tracking cookies and collects no personal data beyond an
// optional display name. This records an explicit acknowledgment from the
// user so we honor consent principles (Art. 6/7 GDPR). Stored locally only.
// =========================================

export type PrivacyConsent = {
  acceptedAt: string;
  version: string;
};

const CONSENT_VERSION = "2026.1";

// True once the first-use notice has ever been shown/dismissed in this browser.
export function hasSeenPrivacyNotice(): boolean {
  return safeGet(NOTICE_SEEN_KEY) === "1";
}

export function markPrivacyNoticeSeen(): void {
  safeSet(NOTICE_SEEN_KEY, "1");
}

// True when the user has explicitly accepted the privacy/consent notice.
export function hasPrivacyConsent(): boolean {
  return !!safeGet(CONSENT_KEY);
}

export function getPrivacyConsent(): PrivacyConsent | null {
  const raw = safeGet(CONSENT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PrivacyConsent;
  } catch {
    return null;
  }
}

export function grantPrivacyConsent(): void {
  const consent: PrivacyConsent = {
    acceptedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
  };
  safeSet(CONSENT_KEY, JSON.stringify(consent));
  markPrivacyNoticeSeen();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_UPDATED_EVENT));
  }
}

export function revokePrivacyConsent(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_UPDATED_EVENT));
  }
}
