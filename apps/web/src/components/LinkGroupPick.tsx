"use client";

import { LINK_GROUPS, type LinkGroup } from "@/lib/linkGroup";

export function LinkGroupPick({
  value,
  onChange,
}: {
  value: LinkGroup | null;
  onChange: (next: LinkGroup | null) => void;
}) {
  return (
    <div className="link-group" role="group" aria-label="Skupina měřítka">
      {LINK_GROUPS.map((g) => {
        const on = value === g;
        return (
          <button
            key={g}
            type="button"
            className={`link-group__btn${on ? " is-active" : ""}`}
            aria-pressed={on}
            title={
              on
                ? `Skupina ${g} — kliknutím odpojíš sdílené měřítko`
                : `Skupina ${g} — stejné písmeno sdílí výšku cenových hladin`
            }
            onClick={(e) => {
              e.stopPropagation();
              onChange(on ? null : g);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {g}
          </button>
        );
      })}
    </div>
  );
}
