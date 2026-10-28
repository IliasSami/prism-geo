import { getActiveBrand, getRawDb } from "@prismgeo/db";
import { Download, Quote } from "lucide-react";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { redirect } from "next/navigation";
import { CitationsClient } from "./CitationsClient";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const PASSAGES_PER_PAGE = 10;
const TYPES = ["brand", "competitor", "editorial"] as const;
type SourceType = (typeof TYPES)[number] | "all";

export default async function CitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; page?: string; pp?: string }>;
}) {
  const params = await searchParams;
  const brand = getActiveBrand();
  // Without a workspace there is nothing to show (and unscoped queries would mix brands)
  if (!brand) redirect("/setup");
  const brandId = brand.id;
  const type: SourceType = (TYPES as readonly string[]).includes(params.type || "") ? (params.type as SourceType) : "all";
  const query = (params.q || "").trim().slice(0, 200);
  const sqlite = getRawDb();
  const toInt = (v: string | undefined) => Math.max(1, parseInt(v || "1", 10) || 1);

  // Totals by kind always cover every stored citation; the table below is filtered and paged
  const countRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_brand_domain), 0) AS brand,
              COALESCE(SUM(CASE WHEN is_competitor_domain = 1 AND is_brand_domain = 0 THEN 1 ELSE 0 END), 0) AS competitor
       FROM citations WHERE brand_id = ?`
    )
    .get(brandId) as { total: number; brand: number; competitor: number };
  // SQLite rows have a null prototype, which cannot be passed to a client component
  const counts = { total: Number(countRow.total), brand: Number(countRow.brand), competitor: Number(countRow.competitor) };

  const where = ["brand_id = ?"];
  const args: Array<string | number> = [brandId];
  if (type === "brand") where.push("is_brand_domain = 1");
  if (type === "competitor") where.push("is_competitor_domain = 1 AND is_brand_domain = 0");
  if (type === "editorial") where.push("is_brand_domain = 0 AND is_competitor_domain = 0");
  if (query) {
    where.push("(domain LIKE ? OR url LIKE ? OR title LIKE ?)");
    args.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const W = where.join(" AND ");
  const filteredTotal = Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM citations WHERE ${W}`).get(...args) as { n: number }).n);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const page = Math.min(totalPages, toInt(params.page));
  const citations = (
    sqlite
      .prepare(`SELECT * FROM citations WHERE ${W} ORDER BY created_at DESC, rank LIMIT ? OFFSET ?`)
      .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as any[]
  ).map((c) => ({
    id: String(c.id),
    domain: String(c.domain),
    url: String(c.url),
    title: c.title ? String(c.title) : null,
    rank: Number(c.rank),
    isBrandDomain: Boolean(c.is_brand_domain),
    isCompetitorDomain: Boolean(c.is_competitor_domain),
  }));

  const passageTotal = Number(
    (sqlite.prepare("SELECT COUNT(*) AS n FROM reverse_rag_chunks WHERE brand_id = ?").get(brandId) as { n: number }).n
  );
  const passagePages = Math.max(1, Math.ceil(passageTotal / PASSAGES_PER_PAGE));
  const passagePage = Math.min(passagePages, toInt(params.pp));
  const chunks = (
    sqlite
      .prepare("SELECT * FROM reverse_rag_chunks WHERE brand_id = ? ORDER BY similarity_score DESC, created_at DESC LIMIT ? OFFSET ?")
      .all(brandId, PASSAGES_PER_PAGE, (passagePage - 1) * PASSAGES_PER_PAGE) as any[]
  ).map((c) => ({
    id: String(c.id),
    sourceUrl: String(c.source_url),
    matchedChunkText: String(c.matched_chunk_text),
    similarityScore: Number(c.similarity_score),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sources"
        description="The pages AI engines cite in their answers, and the passages from those pages that the answers reuse."
        actions={
          counts.total > 0 && (
            <a href={`/api/export?format=csv&type=citations&brandId=${encodeURIComponent(brandId)}`} className={buttonClass("secondary", "md")}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          )
        }
      />
      {counts.total === 0 ? (
        <Card>
          <EmptyState
            icon={<Quote className="h-5 w-5" />}
            title="No sources cited yet"
            description="When an audit captures answers, the links each engine cites are listed here, with the passages its answer reused."
          />
        </Card>
      ) : (
        <CitationsClient
          citations={citations}
          counts={counts}
          type={type}
          query={query}
          page={page}
          totalPages={totalPages}
          filteredTotal={filteredTotal}
          chunks={chunks}
          passagePage={passagePage}
          passagePages={passagePages}
          passageTotal={passageTotal}
        />
      )}
    </div>
  );
}
