/** StockSense open access — no password login. */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export type AuthUserInfo = {
  id: string;
  email?: string | null;
  name?: string | null;
};

const FALLBACK_USER: AuthUserInfo = {
  id: "admin",
  name: "Jakub",
  email: null,
};

export async function getCurrentUser(): Promise<AuthUserInfo> {
  try {
    const res = await fetch(`${API_URL}/me`, { cache: "no-store" });
    if (!res.ok) return FALLBACK_USER;
    const data = (await res.json()) as AuthUserInfo;
    return {
      id: data.id || FALLBACK_USER.id,
      email: data.email ?? null,
      name: data.name || FALLBACK_USER.name,
    };
  } catch {
    return FALLBACK_USER;
  }
}
