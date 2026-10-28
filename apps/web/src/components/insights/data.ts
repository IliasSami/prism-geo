import { getRawDb, type BrandRecord } from "@prismgeo/db";
import { engineRemedy } from "@prismgeo/crawler";
import { rate, type EntityRow, type Report } from "@/lib/report";
import { normalizeDomain, domainMatches } from "@/lib/visibility";

/**
 * Small server-side reads used by the insight pages on top of lib/report.ts.
 * Rules mirror buildReport: organic answers only (active prompts that do not name the brand),
 * a company named in the prompt itself is not counted as mentioned, and citation rates divide by
 * answers whose capture exposes sources.
 */

const escapeRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function terms(name: string, domain: string, aliasesJson: string | null): string[] {
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(aliasesJson || "[]");
  } catch {}
  const stem = normalizeDomain(domain).split(".")[0] || "";
  const generic = /\s+(ai|io|app|inc|hq|voice)$/i;
  return [...new Set([name, name.replace(generic, ""), ...aliases, stem].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 4))];
}

const namesAny = (text: string, list: string[]) => list.some((t) => new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}([^a-z0-9]|$)`, "i").test(text));

/** You vs competitors restricted to one engine, with the same shape as Report.entities. */
export function entitiesForEngine(brand: BrandRecord, engine: string): { entities: EntityRow[]; answers: number; withSources: number } {
  const sqlite = getRawDb();
  const prompts = sqlite.prepare("SELECT id, query_text, intent_type, active FROM prompts WHERE brand_id = ?").all(brand.id) as Array<{
    id: string;
    query_text: string;
    intent_type: string;
    active: number;
  }>;
  const competitors = sqlite.prepare("SELECT name, domain, aliases_json FROM competitors WHERE brand_id = ?").all(brand.id) as Array<{
    name: string;
    domain: string;
    aliases_json: string | null;
  }>;
  const brandTerms = terms(brand.name, brand.domain, brand.aliasesJson);
  const list = [
    { name: brand.name, domain: normalizeDomain(brand.domain), isTarget: true, terms: brandTerms },
    ...competitors.map((c) => ({ name: c.name, domain: normalizeDomain(c.domain), isTarget: false, terms: terms(c.name, c.domain, c.aliases_json) })),
  ];
  const organic = new Map(
    prompts
      .filter((p) => p.active !== 0 && p.intent_type !== "direct" && !namesAny(p.query_text, brandTerms))
      .map((p) => [p.id, new Set(list.filter((e) => namesAny(p.query_text, e.terms)).map((e) => e.name))])
  );

  const runs = (
    sqlite.prepare("SELECT id, prompt_id FROM prompt_runs WHERE brand_id = ? AND engine = ?").all(brand.id, engine) as Array<{ id: string; prompt_id: string }>
  ).filter((r) => organic.has(r.prompt_id));
  const runIds = new Set(runs.map((r) => r.id));
  const promptOf = new Map(runs.map((r) => [r.id, r.prompt_id]));

  const mentions = (
    sqlite
      .prepare(
        "SELECT m.run_id, m.entity_name, m.is_target_brand, m.position_rank, m.sentiment FROM entity_mentions m JOIN prompt_runs r ON r.id = m.run_id WHERE m.brand_id = ? AND r.engine = ?"
      )
      .all(brand.id, engine) as Array<{ run_id: string; entity_name: string; is_target_brand: number; position_rank: number; sentiment: string }>
  ).filter((m) => runIds.has(m.run_id) && !organic.get(promptOf.get(m.run_id)!)?.has(m.is_target_brand ? brand.name : m.entity_name));

  const domainsBy = new Map<string, Set<string>>();
  for (const c of sqlite
    .prepare("SELECT c.run_id, c.domain FROM citations c JOIN prompt_runs r ON r.id = c.run_id WHERE c.brand_id = ? AND r.engine = ?")
    .all(brand.id, engine) as Array<{ run_id: string; domain: string }>) {
    if (!runIds.has(c.run_id)) continue;
    if (!domainsBy.has(c.run_id)) domainsBy.set(c.run_id, new Set());
    domainsBy.get(c.run_id)!.add(normalizeDomain(c.domain));
  }
  const withSources = runs.filter((r) => (domainsBy.get(r.id)?.size || 0) > 0);

  const entities: EntityRow[] = list.map(({ terms: _t, ...e }) => {
    const ms = mentions.filter((m) => (e.isTarget ? m.is_target_brand : !m.is_target_brand && m.entity_name === e.name));
    const cited = e.domain ? withSources.filter((r) => [...(domainsBy.get(r.id) || [])].some((d) => domainMatches(d, e.domain))).length : 0;
    return {
      ...e,
      mentioned: rate(new Set(ms.map((m) => m.run_id)).size, runs.length),
      cited: rate(cited, withSources.length),
      avgPosition: ms.length ? +(ms.reduce((s, m) => s + m.position_rank, 0) / ms.length).toFixed(1) : null,
      positive: ms.filter((m) => m.sentiment === "positive").length,
      negative: ms.filter((m) => m.sentiment === "negative").length,
    };
  });
  entities.sort((a, b) => b.mentioned.hits - a.mentioned.hits || b.cited.hits - a.cited.hits || Number(b.isTarget) - Number(a.isTarget));
  return { entities, answers: runs.length, withSources: withSources.length };
}

export interface EngineHealth {
  engine: string;
  captured: number;
  blocked: number;
  skipped: number;
  noAnswer: number;
  noOverview: number;
  status: "working" | "degraded" | "blocked";
  remedy: string | null;
}

/** Per-engine capture health over all stored answers and recorded failures. */
export function engineHealth(brand: BrandRecord, report: Report): EngineHealth[] {
  const captured = new Map(
    (getRawDb().prepare("SELECT engine, COUNT(*) AS n FROM prompt_runs WHERE brand_id = ? GROUP BY engine").all(brand.id) as Array<{ engine: string; n: number }>).map(
      (r) => [r.engine, Number(r.n)]
    )
  );
  const engines = [...new Set([...captured.keys(), ...Object.keys(report.failures.byEngine)])];
  return engines
    .map((engine) => {
      const f = report.failures.byEngine[engine] || { blocked: 0, skipped: 0, noAnswer: 0, noOverview: 0 };
      const ok = (captured.get(engine) || 0) + f.noOverview;
      const total = ok + f.blocked + f.skipped + f.noAnswer;
      const share = total ? ok / total : 0;
      const status: EngineHealth["status"] = share >= 0.8 ? "working" : share >= 0.2 ? "degraded" : "blocked";
      return {
        engine,
        captured: captured.get(engine) || 0,
        ...f,
        status,
        remedy: status === "working" ? null : engineRemedy(engine, f.blocked + f.skipped > f.noAnswer ? "blocked" : "no_answer"),
      };
    })
    .sort((a, b) => b.captured - a.captured);
}

/** Counts that drive the first-run checklist. */
export function setupCounts(brandId: string): { competitors: number; prompts: number; answers: number } {
  const one = (sql: string) => Number((getRawDb().prepare(sql).get(brandId) as { n: number }).n);
  return {
    competitors: one("SELECT COUNT(*) AS n FROM competitors WHERE brand_id = ?"),
    prompts: one("SELECT COUNT(*) AS n FROM prompts WHERE brand_id = ? AND active = 1"),
    answers: one("SELECT COUNT(*) AS n FROM prompt_runs WHERE brand_id = ?"),
  };
}
