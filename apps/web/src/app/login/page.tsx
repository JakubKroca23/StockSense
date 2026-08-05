"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { loginWithPassword } from "@/lib/auth";
import { StockSenseLogo } from "@/components/StockSenseLogo";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginWithPassword(password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Přihlášení selhalo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="card rise w-full max-w-md p-8">
        <div className="mb-4">
          <StockSenseLogo height={44} />
        </div>
        <p className="muted mb-6">Přihlášení heslem · Sense AI analýza</p>
        <form className="space-y-3" onSubmit={onSubmit}>
          <input
            className="input"
            type="password"
            placeholder="Heslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            autoComplete="current-password"
          />
          {error && <p className="text-[var(--danger)] text-sm">{error}</p>}
          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Pracuji…" : "Přihlásit"}
          </button>
        </form>
      </div>
    </div>
  );
}
