"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Login removed — open access. Keep route so old bookmarks redirect home. */
export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <div className="min-h-screen grid place-items-center muted">
      Přesměrovávám…
    </div>
  );
}
