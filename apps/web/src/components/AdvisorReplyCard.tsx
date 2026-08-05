"use client";

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--text)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[0.85em] text-[var(--accent)]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

type Block =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "hr" };

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", text: trimmed.slice(4).trim() });
      i += 1;
      continue;
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const para: string[] = [trimmed.replace(/^#+\s*/, "")];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.startsWith("## ") ||
        next.startsWith("### ") ||
        /^[-*•]\s+/.test(next) ||
        /^---+$/.test(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

function sectionTone(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("rizik")) return "risk";
  if (t.includes("závěr") || t.includes("shrnutí") || t.includes("pre-")) return "verdict";
  if (t.includes("analýz")) return "analysis";
  return "default";
}

export function AdvisorReplyCard({
  content,
  symbol,
  createdAt,
}: {
  content: string;
  symbol?: string;
  createdAt?: string;
}) {
  const blocks = parseBlocks(content);

  return (
    <article className="advisor-card rise w-full max-w-2xl">
      <header className="advisor-card__head">
        <div>
          <p className="advisor-card__eyebrow">Sense</p>
          <h3 className="advisor-card__title display">Odpověď analýzy</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {symbol ? <span className="badge">{symbol}</span> : null}
          {createdAt ? (
            <span className="muted text-xs">{new Date(createdAt).toLocaleString("cs-CZ")}</span>
          ) : null}
        </div>
      </header>

      <div className="advisor-card__body">
        {blocks.length === 0 ? (
          <p className="muted text-sm">Prázdná odpověď</p>
        ) : (
          blocks.map((block, idx) => {
            if (block.type === "hr") {
              return <hr key={idx} className="advisor-card__hr" />;
            }
            if (block.type === "h2") {
              const tone = sectionTone(block.text);
              return (
                <h4 key={idx} className={`advisor-card__h2 advisor-card__h2--${tone}`}>
                  {renderInline(block.text)}
                </h4>
              );
            }
            if (block.type === "h3") {
              return (
                <h5 key={idx} className="advisor-card__h3">
                  {renderInline(block.text)}
                </h5>
              );
            }
            if (block.type === "ul") {
              return (
                <ul key={idx} className="advisor-card__ul">
                  {block.items.map((item, j) => (
                    <li key={j}>{renderInline(item)}</li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={idx} className="advisor-card__p">
                {renderInline(block.text)}
              </p>
            );
          })
        )}
      </div>

      <footer className="advisor-card__foot">
        Finální rozhodnutí je vždy na tobě. Ověř data quality a rizika.
      </footer>
    </article>
  );
}
