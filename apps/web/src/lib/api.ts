import { getFreshJwt, getSessionJwt } from "./appwrite";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.detail || JSON.stringify(body);
  } catch {
    /* ignore */
  }
  return String(detail);
}

async function doFetch(path: string, init: RequestInit, token: string) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body != null) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await getSessionJwt();
  if (!token) {
    throw new ApiError(401, "Chybí autentizace — zkus se znovu přihlásit");
  }

  let res = await doFetch(path, init, token);

  if (res.status === 401) {
    const retryToken = await getFreshJwt();
    if (retryToken && retryToken !== token) {
      res = await doFetch(path, init, retryToken);
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseError(res));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
