"use client";

import { useParams } from "next/navigation";
import { BybitDesk } from "@/components/BybitDesk";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { getDesk } from "@/lib/desks";

export default function DeskPage() {
  const params = useParams<{ id: string }>();
  const { catalog } = useWorkspace();
  const id = String(params.id || "");
  const layout = catalog.items.find((item) => item.id === id);
  if (!layout) {
    if (!catalog.items.length) return null;
    return (
      <p className="card gold-page__error" role="alert">
        Neznámý layout.
      </p>
    );
  }
  const symbol = getDesk(layout.symbolId) ?? getDesk("btc");
  if (!symbol) {
    return (
      <p className="card gold-page__error" role="alert">
        Neznámý symbol.
      </p>
    );
  }
  return <BybitDesk layoutId={layout.id} config={symbol} />;
}
