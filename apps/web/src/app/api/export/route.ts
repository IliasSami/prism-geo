import { NextResponse } from "next/server";
import { getRawDb } from "@prismgeo/db";
import { jsonError, route } from "../_lib/http";
import { resolveBrand } from "../_lib/brand";
import { sanitizeCsvCell } from "../_lib/csv";

export const dynamic = "force-dynamic";

const FORMATS = ["json", "csv"] as const;
const TYPES = ["citations", "full"] as const;

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "client";

const CSV_COLUMNS = ["captured_at", "engine", "question", "rank", "domain", "url", "title", "snippet", "is_brand", "is_competitor", "run_id"];

interface CitationRow {
  captured_at: string;
  engine: string;
  question: string;
  rank: number;
  domain: string;
  url: string;
  title: string | null;
  snippet: string | null;
  is_brand_domain: number;
  is_competitor_domain: number;
  run_id: string;
}

const CITATIONS_SQL = `
  SELECT c.created_at AS captured_at, r.engine, p.query_text AS question, c.rank, c.domain, c.url, c.title, c.snippet,
         c.is_brand_domain, c.is_competitor_domain, c.run_id
  FROM citations c
  JOIN prompt_runs r ON r.id = c.run_id
  JOIN prompts p ON p.id = r.prompt_id
  WHERE c.brand_id = ?
  ORDER BY c.created_at DESC, c.rank`;

/**
 * Exports a client's data: ?type=citations (default) as ?format=json (default) or csv, or
 * ?type=full as one JSON snapshot. Every row is exported; the CSV is streamed. Filenames name the
 * client and the date. Exports never contain API keys or other settings.
 */
export const GET = route("export", async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";
  const type = searchParams.get("type") || "citations";
  if (!(FORMATS as readonly string[]).includes(format)) return jsonError(`Unknown format "${format}". Use json or csv.`, 400);
  if (!(TYPES as readonly string[]).includes(type)) return jsonError(`Unknown type "${type}". Use citations or full.`, 400);
  if (type === "full" && format !== "json") return jsonError("The full snapshot is only available as JSON", 400);

  const resolved = resolveBrand(request, searchParams.get("brandId"));
  if (!resolved.ok) return resolved.response;
  const { brand } = resolved;
  const date = new Date().toISOString().slice(0, 10);
  const base = `prismgeo-${slug(brand.name)}-${date}`;
  const sqlite = getRawDb();

  if (type === "citations") {
    if (format === "json") {
      const citations = sqlite.prepare(CITATIONS_SQL).all(brand.id);
      return NextResponse.json(
        { brandId: brand.id, brand: brand.name, exportedAt: new Date().toISOString(), count: citations.length, citations },
        { headers: { "Content-Disposition": `attachment; filename="${base}-citations.json"` } },
      );
    }

    // Streamed row by row, so a large history neither truncates nor sits in memory
    const rows = sqlite.prepare(CITATIONS_SQL).iterate(brand.id) as IterableIterator<CitationRow>;
    const encoder = new TextEncoder();
    let started = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // The BOM makes Excel read the file as UTF-8
        let chunk = started ? "" : `﻿${CSV_COLUMNS.join(",")}\n`;
        started = true;
        for (let i = 0; i < 500; i++) {
          const next = rows.next();
          if (next.done) {
            if (chunk) controller.enqueue(encoder.encode(chunk));
            controller.close();
            return;
          }
          const r = next.value;
          chunk += [
            sanitizeCsvCell(r.captured_at),
            sanitizeCsvCell(r.engine),
            sanitizeCsvCell(r.question),
            Number(r.rank) || 0,
            sanitizeCsvCell(r.domain),
            sanitizeCsvCell(r.url),
            sanitizeCsvCell(r.title),
            sanitizeCsvCell(r.snippet),
            r.is_brand_domain ? "true" : "false",
            r.is_competitor_domain ? "true" : "false",
            sanitizeCsvCell(r.run_id),
          ].join(",") + "\n";
        }
        controller.enqueue(encoder.encode(chunk));
      },
      cancel() {
        rows.return?.();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-citations.csv"` },
    });
  }

  // Full JSON snapshot: everything measured for the client
  const all = (sql: string) => sqlite.prepare(sql).all(brand.id);
  const snapshot = {
    exportedAt: new Date().toISOString(),
    brand: sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brand.id),
    competitors: all("SELECT * FROM competitors WHERE brand_id = ?"),
    prompts: all("SELECT * FROM prompts WHERE brand_id = ?"),
    batches: all("SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at"),
    runs: all("SELECT * FROM prompt_runs WHERE brand_id = ? ORDER BY created_at"),
    citations: all("SELECT * FROM citations WHERE brand_id = ?"),
    mentions: all("SELECT * FROM entity_mentions WHERE brand_id = ?"),
    passages: all("SELECT * FROM reverse_rag_chunks WHERE brand_id = ?"),
  };
  return new Response(JSON.stringify(snapshot), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-snapshot.json"` },
  });
});
