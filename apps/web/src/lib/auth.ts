/** StockSense password auth — locally signed API JWT (no Appwrite). */

const TOKEN_KEY = "stocksense_api_token";
const TOKEN_EXP_KEY = "stocksense_api_token_exp";
const USER_KEY = "stocksense_user";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export type AuthUserInfo = {
  id: string;
  email?: string | null;
  name?: string | null;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function storeApiToken(token: string, expiresInSec: number) {
  if (!canUseStorage()) return;
  const exp = Date.now() + expiresInSec * 1000;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(TOKEN_EXP_KEY, String(exp));
}

export function storeAuthUser(user: AuthUserInfo) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthTokens() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_EXP_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem("stocksense_session");
}

export function readStoredUser(): AuthUserInfo | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUserInfo;
  } catch {
    return null;
  }
}

export function getStoredApiToken(): string | null {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function isTokenExpired(): boolean {
  if (!canUseStorage()) return true;
  const expRaw = window.localStorage.getItem(TOKEN_EXP_KEY);
  if (!expRaw) return !window.localStorage.getItem(TOKEN_KEY);
  const exp = Number(expRaw);
  return !Number.isFinite(exp) || Date.now() > exp - 60_000;
}

type AuthResponse = {
  access_token: string;
  expires_in: number;
  user: AuthUserInfo;
};

async function postAuth(path: string, body: unknown, token?: string): Promise<AuthResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : "Autentizace selhala");
  }
  return res.json() as Promise<AuthResponse>;
}

export async function loginWithPassword(password: string): Promise<AuthUserInfo> {
  const data = await postAuth("/auth/login", { password });
  storeApiToken(data.access_token, data.expires_in);
  storeAuthUser(data.user);
  return data.user;
}

export async function refreshApiToken(): Promise<string | null> {
  const current = getStoredApiToken();
  if (!current) return null;
  try {
    const data = await postAuth("/auth/refresh", {}, current);
    storeApiToken(data.access_token, data.expires_in);
    storeAuthUser(data.user);
    return data.access_token;
  } catch {
    return null;
  }
}

export async function getSessionJwt(): Promise<string | null> {
  const token = getStoredApiToken();
  if (!token) return null;
  if (isTokenExpired()) {
    const refreshed = await refreshApiToken();
    if (refreshed) return refreshed;
    clearAuthTokens();
    return null;
  }
  return token;
}

export async function getFreshJwt(): Promise<string | null> {
  return refreshApiToken();
}

export async function ensureApiAuth(): Promise<boolean> {
  return Boolean(await getSessionJwt());
}

export async function getCurrentUser(): Promise<AuthUserInfo | null> {
  const token = await getSessionJwt();
  if (!token) return null;
  const cached = readStoredUser();
  if (cached) return cached;
  try {
    const res = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AuthUserInfo;
    storeAuthUser(data);
    return data;
  } catch {
    return null;
  }
}
