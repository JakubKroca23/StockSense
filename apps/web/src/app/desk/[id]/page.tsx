"use client";

import { useParams } from "next/navigation";
import { BybitDesk } from "@/components/BybitDesk";
import { getDesk } from "@/lib/desks";

export default function DeskPage() {
  const params = useParams<{ id: string }>();
  const desk = getDesk(String(params.id || ""));
  if (!desk) {
    return (
      <p className="card gold-page__error" role="alert">
        Neznámý desk.
      </p>
    );
  }
  return <BybitDesk key={desk.id} config={desk} />;
}
