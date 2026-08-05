import { Account, Client } from "appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "";
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || "";

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

/** Persist session secret from login so the API can auth without minting a JWT every call. */
export function storeSessionSecret(secret: string | undefined | null) {
  if (!secret || !canUseStorage()) return;
  try {
    window.localStorage.setItem(SESSION_KEY, secret);
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

/** Appwrite stores cross-origin sessions in localStorage under cookieFallback. */
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

async function mintJwt(): Promise<string | null> {
  if (cachedJwt && cachedJwt.expiresAt > Date.now() + 15_000) {
    return cachedJwt.token;
  }
  try {
    const result = await account.createJWT({ duration: 900 });
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
 * Prefer stable session secret (no rate limits), then cached/minted JWT.
 */
export async function getSessionJwt(): Promise<string | null> {
  const stored = readStoredSessionSecret();
  if (stored) return stored;

  const fallback = recoverSessionFromFallback();
  if (fallback) return fallback;

  return mintJwt();
}

/** Force a fresh Appwrite JWT (used after a 401 with a session secret). */
export async function getFreshJwt(): Promise<string | null> {
  clearJwtCache();
  return mintJwt();
}

/** Warm auth token cache before rendering authenticated pages. */
export async function ensureApiAuth(): Promise<boolean> {
  const token = await getSessionJwt();
  return Boolean(token);
}

export async function getCurrentUser() {
  try {
    return await account.get();
  } catch {
    return null;
  }
}
