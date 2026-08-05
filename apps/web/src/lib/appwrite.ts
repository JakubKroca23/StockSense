import { Account, Client } from "appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || "stocksense";

const SESSION_KEY = "stocksense_session";
/** Appwrite JWT default lifetime is 15 minutes — refresh a bit earlier. */
const JWT_TTL_MS = 14 * 60 * 1000;

export const appwriteClient = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(appwriteClient);

type CachedJwt = { token: string; expiresAt: number };

let cachedJwt: CachedJwt | null = null;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Persist session secret so the API can auth without minting a JWT every call. */
export function storeSessionSecret(secret: string | undefined | null) {
  if (!secret || !canUseStorage()) return;
  try {
    window.localStorage.setItem(SESSION_KEY, secret);
    appwriteClient.setSession(secret);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearJwtCache() {
  cachedJwt = null;
}

export function clearAuthTokens() {
  clearJwtCache();
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function readStoredSessionSecret(): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Appwrite client sessions store the secret in cookieFallback (cross-origin),
 * not in Session.secret (that field is empty without an API key).
 */
export function recoverSessionFromFallback(): string | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem("cookieFallback");
    if (!raw) return null;
    const cookies = JSON.parse(raw) as Record<string, unknown>;
    const preferred = projectId ? `a_session_${projectId}` : null;
    if (preferred && typeof cookies[preferred] === "string" && cookies[preferred]) {
      const secret = cookies[preferred] as string;
      storeSessionSecret(secret);
      return secret;
    }
    for (const [key, value] of Object.entries(cookies)) {
      if (
        key.startsWith("a_session_") &&
        !key.endsWith("_legacy") &&
        typeof value === "string" &&
        value.length > 0
      ) {
        storeSessionSecret(value);
        return value;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Keep Client + localStorage in sync with Appwrite cookieFallback. */
export function syncSessionFromStorage(): string | null {
  const fromFallback = recoverSessionFromFallback();
  if (fromFallback) return fromFallback;
  const stored = readStoredSessionSecret();
  if (stored) {
    try {
      appwriteClient.setSession(stored);
    } catch {
      /* ignore */
    }
    return stored;
  }
  return null;
}

async function mintJwt(): Promise<string | null> {
  if (cachedJwt && cachedJwt.expiresAt > Date.now() + 15_000) {
    return cachedJwt.token;
  }
  syncSessionFromStorage();
  try {
    let result;
    try {
      result = await account.createJWT({ duration: 900 });
    } catch {
      // Some Appwrite builds reject custom duration — fall back to default TTL.
      result = await account.createJWT();
    }
    const token = result?.jwt;
    if (!token) return null;
    cachedJwt = { token, expiresAt: Date.now() + JWT_TTL_MS };
    return token;
  } catch {
    cachedJwt = null;
    return null;
  }
}

/**
 * Token for StockSense API (Bearer).
 * Prefer short-lived JWT (reliable with Appwrite 1.8+); session secret as fallback.
 */
export async function getSessionJwt(): Promise<string | null> {
  const jwt = await mintJwt();
  if (jwt) return jwt;

  const synced = syncSessionFromStorage();
  if (synced) return synced;

  return null;
}

/** Force a fresh Appwrite JWT (used after a 401). */
export async function getFreshJwt(): Promise<string | null> {
  clearJwtCache();
  // Drop cached session secret — it may be stale; re-read cookieFallback.
  if (canUseStorage()) {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  syncSessionFromStorage();
  return mintJwt();
}

/** Warm auth token cache before rendering authenticated pages. */
export async function ensureApiAuth(): Promise<boolean> {
  syncSessionFromStorage();
  const token = await getSessionJwt();
  return Boolean(token);
}

export async function getCurrentUser() {
  try {
    syncSessionFromStorage();
    return await account.get();
  } catch {
    return null;
  }
}
