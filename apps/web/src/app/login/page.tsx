"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { account, ensureApiAuth, recoverSessionFromFallback, storeSessionSecret } from "@/lib/appwrite";
import { ID } from "appwrite";
import { StockSenseLogo } from "@/components/StockSenseLogo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "register") {
        await account.create({
          userId: ID.unique(),
          email,
          password,
          name: "StockSense User",
        });
      }
      const session = await account.createEmailPasswordSession({ email, password });
      // Session.secret is empty for browser SDK (Appwrite 1.8+) — use cookieFallback.
      if (session.secret) storeSessionSecret(session.secret);
      recoverSessionFromFallback();
      const ok = await ensureApiAuth();
      if (!ok) {
        throw new Error("Přihlášení proběhlo, ale API token se nevytvořil. Zkus obnovit stránku.");
      }
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
        <p className="muted mb-6">Přihlášení přes Appwrite · Sense AI analýza</p>
        <form className="space-y-3" onSubmit={onSubmit}>
          <input
            className="input"
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Heslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <p className="text-[var(--danger)] text-sm">{error}</p>}
          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Pracuji…" : mode === "login" ? "Přihlásit" : "Vytvořit účet"}
          </button>
        </form>
        <button
          className="btn w-full mt-3"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "Nemám účet — registrace" : "Už mám účet — přihlášení"}
        </button>
      </div>
    </div>
  );
}
