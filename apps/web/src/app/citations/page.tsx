import { getActiveBrand, getRawDb } from "@prismgeo/db";
import { Download, Link2 } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, buttonClass } from "@/components/ui";
import { redirect } from "next/navigation";
import { CitationsClient, type SourceRow, type SourceType, type View } from "./CitationsClient";
import { LastAuditFailed, NoAnswers } from "@/components/insights/parts";
import { getLatestAudit } from "@/components/insights/engine-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sources" };

const PAGE_SIZE = 25;
const PASSAGES_PER_PAGE = 10;
const TYPES = ["brand", "competitor", "editorial"] as const;

const TYPE_SQL: Record<Exclude<SourceType, "all">, string> = {
  brand: "c.is_brand_domain = 1",
  competitor: "c.is_competitor_domain = 1 AND c.is_brand_domain = 0",
  editorial: "c.is_brand_domain = 0 AND c.is_competitor_domain = 0",
};

/**
 * Sources: the pages (or whole sites) AI engines cite, grouped so each appears once with how many
 * answers cited it, on which engines, and its best position. Grouping, filtering and paging all
 * happen in SQL, so every stored citation is reachable.
 */
export default async function CitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; page?: string; pp?: string; view?: string }>;
}) {
  const params = await searchParams;
  const brand = getActiveBrand();
  // Without a workspace there is nothing to show (and unscoped queries would mix brands)
  if (!brand) redirect("/setup");
  const brandId = brand.id;
  const view: View = params.view === "domains" || params.view === "passages" ? params.view : "pages";
  const type: SourceType = (TYPES as readonly string[]).includes(params.type || "") ? (params.type as SourceType) : "all";
  const query = (params.q || "").trim().slice(0, 200);
  const sqlite = getRawDb();
  const toInt = (v: string | undefined) => Math.max(1, parseInt(v || "1", 10) || 1);

  const total = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM citations WHERE brand_id = ?").get(brandId) as { n: number }).n);
  const passageTotal = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM reverse_rag_chunks WHERE brand_id = ?").get(brandId) as { n: number }).n);

  if (total === 0 && passageTotal === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader title="Sources" description="The pages AI engines cite in their answers, and the passages from those pages that the answers reuse." />
        <NoAnswers latest={getLatestAudit(brandId)} icon={<Link2 className="h-5 w-5" />} what="The sources list" />
      </div>
    );
  }

  const key = view === "domains" ? "c.domain" : "c.url";
  const search = query ? ["(c.domain LIKE ? OR c.url LIKE ? OR c.title LIKE ?)"] : [];
  const searchArgs = query ? [`%${query}%`, `%${query}%`, `%${query}%`] : [];

  // Distinct pages (or sites) per type, for the filter counts; the search applies to them too
  const typeCounts = { all: 0, brand: 0, competitor: 0, editorial: 0 } as Record<SourceType, number>;
  for (const t of ["all", ...TYPES] as SourceType[]) {
    const where = ["c.brand_id = ?", ...search, ...(t === "all" ? [] : [TYPE_SQL[t]])].join(" AND ");
    typeCounts[t] = Number((sqlite.prepare(`SELECT COUNT(DISTINCT ${key}) AS n FROM citations c WHERE ${where}`).get(brandId, ...searchArgs) as { n: number }).n);
  }

  const where = ["c.brand_id = ?", ...search, ...(type === "all" ? [] : [TYPE_SQL[type]])].join(" AND ");
  const filtered = typeCounts[type];
  const totalPages = Math.max(1, Math.ceil(filtered / PAGE_SIZE));
  const page = Math.min(totalPages, toInt(params.page));
  const rows: SourceRow[] =
    view === "passages"
      ? []
      : (
          sqlite
            .prepare(
              `SELECT ${key} AS k, MAX(c.domain) AS domain, MAX(c.url) AS url, MAX(c.title) AS title,
                      MAX(c.is_brand_domain) AS is_brand, MAX(CASE WHEN c.is_brand_domain = 0 THEN c.is_competitor_domain ELSE 0 END) AS is_comp,
                      COUNT(DISTINCT c.run_id) AS answers, COUNT(DISTINCT c.url) AS pages, MIN(c.rank) AS best,
                      GROUP_CONCAT(DISTINCT r.engine) AS engines
               FROM citations c LEFT JOIN prompt_runs r ON r.id = c.run_id
               WHERE ${where} GROUP BY ${key} ORDER BY answers DESC, best ASC, k ASC LIMIT ? OFFSET ?`
            )
            .all(brandId, ...searchArgs, PAGE_SIZE, (page - 1) * PAGE_SIZE) as Array<Record<string, unknown>>
        ).map((r) => ({
          key: String(r.k),
          domain: String(r.domain),
          url: String(r.url),
          title: r.title ? String(r.title) : null,
          isBrand: Number(r.is_brand) === 1,
          isCompetitor: Number(r.is_comp) === 1,
          answers: Number(r.answers),
          pages: Number(r.pages),
          best: Number(r.best),
          engines: String(r.engines || "")
            .split(",")
            .filter(Boolean),
        }));

  const passagePages = Math.max(1, Math.ceil(passageTotal / PASSAGES_PER_PAGE));
  const passagePage = Math.min(passagePages, toInt(params.pp));
  const chunks =
    view === "passages"
      ? (
          sqlite
            .prepare("SELECT * FROM reverse_rag_chunks WHERE brand_id = ? ORDER BY similarity_score DESC, created_at DESC LIMIT ? OFFSET ?")
            .all(brandId, PASSAGES_PER_PAGE, (passagePage - 1) * PASSAGES_PER_PAGE) as Array<Record<string, unknown>>
        ).map((c) => ({
          id: String(c.id),
          sourceUrl: String(c.source_url),
          matchedChunkText: String(c.matched_chunk_text),
          similarityScore: Number(c.similarity_score),
        }))
      : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sources"
        description="The pages AI engines cite in their answers, and the passages from those pages that the answers reuse."
        actions={
          total > 0 && (
            <a href={`/api/export?format=csv&type=citations&brandId=${encodeURIComponent(brandId)}`} className={buttonClass("secondary", "md")}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          )
        }
      />
      <LastAuditFailed latest={getLatestAudit(brandId)} />
      <CitationsClient
        view={view}
        rows={rows}
        typeCounts={typeCounts}
        citationTotal={total}
        type={type}
        query={query}
        page={page}
        totalPages={totalPages}
        chunks={chunks}
        passagePage={passagePage}
        passagePages={passagePages}
        passageTotal={passageTotal}
      />
    </div>
  );
}
