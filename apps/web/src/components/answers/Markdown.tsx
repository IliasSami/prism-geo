import type { ReactNode } from "react";

/**
 * A small, safe markdown renderer for captured answers. API routes return markdown; browser
 * captures are plain text. Supported: headings, bold, italics, inline code, links (http/https
 * only), bullet and numbered lists, block quotes, rules, fenced code and simple tables.
 * Everything is rendered as React text nodes, so nothing in an answer is ever parsed as HTML.
 * Brand and competitor highlights are applied to the text nodes, after markdown is resolved.
 */

export interface HighlightGroup {
  terms: string[];
  isBrand: boolean;
}

type Highlighter = (text: string, key: string) => ReactNode[];

const escapeRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks your brand (accent) and tracked competitors (neutral) wherever they are named. */
export function makeHighlighter(groups: HighlightGroup[]): Highlighter {
  const entries = groups
    .flatMap((g) => g.terms.map((t) => ({ term: t.trim(), isBrand: g.isBrand })))
    .filter((e) => e.term.length >= 3)
    .sort((a, b) => b.term.length - a.term.length);
  if (entries.length === 0) return (text) => [text];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${entries.map((e) => escapeRegex(e.term)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const brandTerms = new Set(entries.filter((e) => e.isBrand).map((e) => e.term.toLowerCase()));
  return (text, key) => {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > last) parts.push(text.slice(last, i));
      const isBrand = brandTerms.has(m[0].toLowerCase());
      parts.push(
        <mark
          key={`${key}-${i}`}
          data-entity={isBrand ? "you" : "competitor"}
          className={isBrand ? "rounded bg-accent-100 px-0.5 text-accent-800 ring-1 ring-inset ring-accent-200" : "rounded bg-zinc-200 px-0.5 text-zinc-900"}
        >
          {m[0]}
        </mark>
      );
      last = i + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
}

/* ── Inline ──────────────────────────────────────────────────────────────── */

const INLINE =
  /(`[^`\n]+`)|(\*\*(?=\S)[\s\S]*?\S\*\*)|(__(?=\S)[\s\S]*?\S__)|(\[[^\]\n]+\]\([^)\s]+\))|(\*(?=[^\s*])[^*\n]*?[^\s*]\*|\*[^\s*]\*)|((?<![\p{L}\p{N}_])_(?=[^\s_])[^_\n]*?[^\s_]_(?![\p{L}\p{N}_]))/gu;

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, hl: Highlighter, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(...hl(text.slice(last, i), `${key}t${n}`));
    const tok = m[0];
    const k = `${key}i${n++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-zinc-800">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (m[2] || m[3]) {
      out.push(
        <strong key={k} className="font-semibold text-zinc-900">
          {inline(tok.slice(2, -2), hl, k)}
        </strong>
      );
    } else if (m[4]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) || [];
      const url = href ? safeUrl(href) : null;
      out.push(
        url ? (
          <a key={k} href={url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-accent-700 underline decoration-accent-200 underline-offset-2 hover:decoration-accent-600">
            {inline(label, hl, k)}
          </a>
        ) : (
          <span key={k}>{hl(tok, k)}</span>
        )
      );
    } else {
      out.push(
        <em key={k} className="italic">
          {inline(tok.slice(1, -1), hl, k)}
        </em>
      );
    }
    last = i + tok.length;
  }
  if (last < text.length) out.push(...hl(text.slice(last), `${key}t${n}`));
  return out;
}

/* ── Blocks ──────────────────────────────────────────────────────────────── */

type Block =
  | { type: "p"; lines: string[] }
  | { type: "h"; level: number; text: string }
  | { type: "ul" | "ol"; items: Array<{ text: string; depth: number; n?: number }> }
  | { type: "quote"; lines: string[] }
  | { type: "code"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "hr" };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const bullet = /^(\s*)[-*+•]\s+(.*)$/;
  const numbered = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      blocks.push({ type: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", lines: body });
      continue;
    }
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line);
      const items: Array<{ text: string; depth: number; n?: number }> = [];
      while (i < lines.length) {
        const b = bullet.exec(lines[i]);
        const o = numbered.exec(lines[i]);
        if (b || o) {
          const indent = (b ? b[1] : o![1]).replace(/\t/g, "    ").length;
          items.push({ text: b ? b[2] : o![3], depth: Math.min(3, Math.floor(indent / 2)), n: o ? Number(o[2]) : undefined });
          i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          // Continuation of the previous item
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        } else break;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    )
      para.push(lines[i++]);
    blocks.push({ type: "p", lines: para });
  }
  return blocks;
}

export function Markdown({ text, highlight }: { text: string; highlight: Highlighter }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 text-base leading-relaxed text-zinc-800">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.type) {
          case "h": {
            const cls = b.level <= 2 ? "pt-1 text-md font-semibold text-zinc-900" : "font-semibold text-zinc-900";
            return b.level <= 2 ? (
              <h3 key={k} className={cls}>
                {inline(b.text, highlight, k)}
              </h3>
            ) : (
              <h4 key={k} className={cls}>
                {inline(b.text, highlight, k)}
              </h4>
            );
          }
          case "ul":
          case "ol": {
            const ListTag = b.type;
            return (
              <ListTag key={k} start={b.type === "ol" ? b.items[0]?.n : undefined} className={b.type === "ul" ? "list-disc space-y-1 pl-5" : "list-decimal space-y-1 pl-6"}>
                {b.items.map((it, ii) => (
                  <li key={ii} style={it.depth ? { marginLeft: `${it.depth * 1.25}rem` } : undefined} className="pl-0.5">
                    {inline(it.text, highlight, `${k}l${ii}`)}
                  </li>
                ))}
              </ListTag>
            );
          }
          case "quote":
            return (
              <blockquote key={k} className="whitespace-pre-line border-l-2 border-zinc-300 pl-3 text-zinc-700">
                {inline(b.lines.join("\n"), highlight, k)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-lg bg-zinc-50 p-3 font-mono text-sm text-zinc-800 ring-1 ring-zinc-200">
                {b.text}
              </pre>
            );
          case "table":
            return (
              <div key={k} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className={ri === 0 ? "bg-zinc-50 font-medium text-zinc-900" : ""}>
                        {r.map((c, ci) => (
                          <td key={ci} className="border border-zinc-200 px-2 py-1 align-top">
                            {inline(c, highlight, `${k}r${ri}c${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={k} className="border-zinc-200" />;
          default:
            return (
              <p key={k} className="whitespace-pre-line">
                {inline(b.lines.join("\n"), highlight, k)}
              </p>
            );
        }
      })}
    </div>
  );
}
