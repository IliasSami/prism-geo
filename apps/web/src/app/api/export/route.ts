import { NextResponse } from "next/server";
import { getRawDb, getActiveBrand } from "@prismgeo/db";

export const dynamic = "force-dynamic";

function sanitizeCsvCell(val: any): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Neutralize CSV formula execution in Excel/Sheets (CWE-1236)
  if (/^[=+\-@\t\r|]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    const type = searchParams.get("type") || "citations";
    const brandParam = searchParams.get("brandId");

    const activeBrand = getActiveBrand();
    const brandId = brandParam || activeBrand?.id;

    if (!brandId) {
      return NextResponse.json({ error: "No active brand selected" }, { status: 400 });
    }

    const safeBrandId = brandId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const limitParam = Number(searchParams.get("limit")) || 5000;
    const limit = Math.min(25000, Math.max(1, limitParam));

    const sqlite = getRawDb();

    if (type === "citations") {
      const rows = sqlite
        .prepare(
          `SELECT domain, url, title, snippet, rank, is_brand_domain, is_competitor_domain, created_at
           FROM citations
           WHERE brand_id = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(brandId, limit) as any[];

      if (format === "csv") {
        const headers = ["domain", "url", "title", "snippet", "rank", "is_brand", "is_competitor", "created_at"];
        const csvRows = [headers.join(",")];
        for (const r of rows) {
          const vals = [
            sanitizeCsvCell(r.domain),
            sanitizeCsvCell(r.url),
            sanitizeCsvCell(r.title),
            sanitizeCsvCell(r.snippet),
            r.rank,
            r.is_brand_domain ? "true" : "false",
            r.is_competitor_domain ? "true" : "false",
            sanitizeCsvCell(r.created_at),
          ];
          csvRows.push(vals.join(","));
        }

        return new NextResponse(csvRows.join("\n"), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="prismgeo-citations-${safeBrandId}.csv"`,
          },
        });
      }

      return NextResponse.json({ brandId, count: rows.length, citations: rows });
    }

    // Default full JSON snapshot
    const brand = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
    if (!brand) {
      return NextResponse.json({ error: `Brand ${brandId} not found` }, { status: 404 });
    }
    const competitors = sqlite.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brandId);
    const prompts = sqlite.prepare("SELECT * FROM prompts WHERE brand_id = ?").all(brandId);
    // Everything measured for the brand: batches, answers, citations, mentions, matched passages
    const all = (sql: string) => sqlite.prepare(sql).all(brandId);
    const batches = all("SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at");
    const runs = all("SELECT * FROM prompt_runs WHERE brand_id = ? ORDER BY created_at");
    const citations = all("SELECT * FROM citations WHERE brand_id = ?");
    const mentions = all("SELECT * FROM entity_mentions WHERE brand_id = ?");
    const passages = all("SELECT * FROM reverse_rag_chunks WHERE brand_id = ?");

    const snapshot = {
      exportedAt: new Date().toISOString(),
      brand,
      competitors,
      prompts,
      batches,
      runs,
      citations,
      mentions,
      passages,
    };

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="prismgeo-audit-snapshot-${safeBrandId}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
