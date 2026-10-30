import { ENGINE_IDS } from "@prismgeo/core";
import { getRawDb } from "@prismgeo/db";
import { activeBrandFromCookies } from "@/app/api/_lib/brand";
import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { ResponsesClient } from "./ResponsesClient";
import { NoAnswers } from "@/components/insights/parts";
import { getLatestAudit } from "@/components/insights/engine-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Answers" };

const PAGE_SIZE = 25;
const ENGINES: readonly string[] = ENGINE_IDS;

export default async function ResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ engine?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const brand = await activeBrandFromCookies();
  // Without a workspace there is nothing to show (and unscoped queries would mix brands)
  if (!brand) redirect("/setup");
  const brandId = brand?.id || "";
  const engine = ENGINES.includes(params.engine || "") ? params.engine! : "all";
  const query = (params.q || "").trim().slice(0, 200);
  const sqlite = getRawDb();

  const where = ["r.brand_id = ?"];
  const args: Array<string | number> = [brandId];
  if (engine !== "all") (where.push("r.engine = ?"), args.push(engine));
  if (query) {
    where.push("(p.query_text LIKE ? OR r.response_text LIKE ?)");
    args.push(`%${query}%`, `%${query}%`);
  }
  const W = where.join(" AND ");
  // Engines that have answers (for the current search), with counts, for the engine filter
  const countWhere = ["r.brand_id = ?", ...(query ? ["(p.query_text LIKE ? OR r.response_text LIKE ?)"] : [])];
  const countArgs = query ? [brandId, `%${query}%`, `%${query}%`] : [brandId];
  const engineCounts = (
    sqlite
      .prepare(`SELECT r.engine AS engine, COUNT(*) AS n FROM prompt_runs r JOIN prompts p ON p.id = r.prompt_id WHERE ${countWhere.join(" AND ")} GROUP BY r.engine ORDER BY n DESC`)
      .all(...countArgs) as Array<{ engine: string; n: number }>
  ).map((r) => ({ engine: String(r.engine), count: Number(r.n) }));
  const total = Number(
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM prompt_runs r JOIN prompts p ON p.id = r.prompt_id WHERE ${W}`).get(...args) as { n: number }).n
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(params.page || "1", 10) || 1));
  const rows = sqlite
    .prepare(
      `SELECT r.*, p.query_text, p.intent_type FROM prompt_runs r JOIN prompts p ON p.id = r.prompt_id
       WHERE ${W} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as any[];
  const citationStmt = sqlite.prepare("SELECT url, domain, title FROM citations WHERE run_id = ? ORDER BY rank");
  const namedStmt = sqlite.prepare("SELECT 1 FROM entity_mentions WHERE run_id = ? AND is_target_brand = 1 LIMIT 1");
  // Plain objects only: node:sqlite rows have a null prototype and cannot cross to a client component
  const runs = rows.map((r) => {
    let searches: string[] = [];
    try {
      const parsed = JSON.parse(r.sub_queries_json || "[]");
      if (Array.isArray(parsed)) searches = parsed.map((q: unknown) => String(q)).filter(Boolean);
    } catch {}
    return {
      id: String(r.id),
      engine: String(r.engine),
      responseText: String(r.response_text || ""),
      searches,
      executionMs: Number(r.execution_ms) || 0,
      createdAt: String(r.created_at),
      captureMethod: String(r.capture_method || "browser"),
      queryText: String(r.query_text || ""),
      namedYou: Boolean(namedStmt.get(r.id)),
      citations: (citationStmt.all(r.id) as any[]).map((c) => ({ url: String(c.url), domain: String(c.domain), title: c.title ? String(c.title) : null })),
    };
  });

  // Names to highlight in answers: your brand and tracked competitors, with their aliases
  const parseAliases = (json: unknown) => {
    try {
      const v = JSON.parse(String(json || "[]"));
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  const highlights = [
    { terms: [brand.name, ...parseAliases(brand.aliasesJson)], isBrand: true },
    ...(sqlite.prepare("SELECT name, aliases_json FROM competitors WHERE brand_id = ?").all(brandId) as any[]).map((c) => ({
      terms: [String(c.name), ...parseAliases(c.aliases_json)],
      isBrand: false,
    })),
  ];
  const hasAnyRuns = total > 0 || engine !== "all" || query !== "";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Answers"
        description="What each engine actually answered, with the sources it cited and, where exposed, the searches it ran. Failed runs are listed on Engines, never filled in."
      />
      {!hasAnyRuns ? (
        <NoAnswers latest={getLatestAudit(brand.id)} icon={<MessageSquare className="h-5 w-5" />} what="This page" />
      ) : (
        <ResponsesClient
          runs={runs}
          engine={engine}
          query={query}
          page={page}
          totalPages={totalPages}
          total={total}
          brandName={brand.name}
          highlights={highlights}
          engineCounts={engineCounts}
        />
      )}
    </div>
  );
}
