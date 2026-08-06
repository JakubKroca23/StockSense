/** Client-side CSV download helper (UTF-8 BOM for Excel). */
export function downloadCsv(filename: string, csvBody: string) {
  const blob = new Blob(["\ufeff" + csvBody], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) lines.push(row.map(esc).join(","));
  return lines.join("\n") + "\n";
}

/** Download CSV from API (open access). */
export async function downloadApiCsv(path: string, filename: string) {
  const base = process.env.NEXT_PUBLIC_API_URL || "/api";
  const res = await fetch(`${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Export selhal (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
