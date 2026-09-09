// Client-side anonymous identifier used ONLY to throttle abuse of shared
// resources (the free-tier key). It is a random, unlinkable id generated in
// the browser and stored in localStorage — NOT the user's IP. It carries no
// identity and cannot be traced back to a person, honoring the app's privacy
// promise while still letting the server rate-limit per browser.

const TOKEN_KEY = "orcachat_anon_token";

let cachedToken: string | null = null;

export function getAnonClientToken(): string {
  if (typeof window === "undefined") return "";
  if (cachedToken) return cachedToken;
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
      localStorage.setItem(TOKEN_KEY, token);
    }
    cachedToken = token;
    return token;
  } catch {
    return "";
  }
}