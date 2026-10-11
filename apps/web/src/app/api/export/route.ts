import { NextResponse } from "next/server";
import { getRawDb, getActiveBrand } from "@prismgeo/db";

export const dynamic = "force-dynamic";

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

    const sqlite = getRawDb();

    if (type === "citations") {
      const rows = sqlite
        .prepare(
          `SELECT domain, url, title, snippet, rank, is_brand_domain, is_competitor_domain, created_at
           FROM citations
           WHERE brand_id = ?
           ORDER BY created_at DESC`
        )
        .all(brandId) as any[];

      if (format === "csv") {
        const headers = ["domain", "url", "title", "snippet", "rank", "is_brand", "is_competitor", "created_at"];
        const csvRows = [headers.join(",")];
        for (const r of rows) {
          const vals = [
            `"${(r.domain || "").replace(/"/g, '""')}"`,
            `"${(r.url || "").replace(/"/g, '""')}"`,
            `"${(r.title || "").replace(/"/g, '""')}"`,
            `"${(r.snippet || "").replace(/"/g, '""')}"`,
            r.rank,
            r.is_brand_domain ? "true" : "false",
            r.is_competitor_domain ? "true" : "false",
            `"${r.created_at}"`,
          ];
          csvRows.push(vals.join(","));
        }

        return new NextResponse(csvRows.join("\n"), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="prismgeo-citations-${brandId}.csv"`,
          },
        });
      }

      return NextResponse.json({ brandId, count: rows.length, citations: rows });
    }

    // Default full JSON snapshot
    const brand = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
    const competitors = sqlite.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brandId);
    const prompts = sqlite.prepare("SELECT * FROM prompts WHERE brand_id = ?").all(brandId);
    const citations = sqlite.prepare("SELECT * FROM citations WHERE brand_id = ? LIMIT 500").all(brandId);
    const opportunities = sqlite.prepare("SELECT * FROM opportunities WHERE brand_id = ?").all(brandId);

    const snapshot = {
      exportedAt: new Date().toISOString(),
      brand,
      competitors,
      prompts,
      citationsCount: citations.length,
      citations,
      opportunities,
    };

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="prismgeo-audit-snapshot-${brandId}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
