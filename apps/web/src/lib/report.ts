import { getRawDb, type BrandRecord } from "@prismgeo/db";
import { MonteCarloMetricsCalculator } from "@prismgeo/core";
import { normalizeDomain, domainMatches } from "./visibility";

/**
 * One measured picture of a brand's AI-search visibility, computed from stored runs only, for the
 * decision pages (Overview, Visibility, Opportunities). Every rate states its sample (n) and a
 * Wilson 95% range, so small samples are visible as such instead of looking precise.
 */

export const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google_aio: "Google AI Overviews",
  copilot: "Copilot",
};

export interface Rate {
  hits: number;
  n: number;
  pct: number;
  /** Wilson 95% interval, in percent. */
  low: number;
  high: number;
}

export interface EntityRow {
  name: string;
  domain: string;
  isTarget: boolean;
  /** Share of organic answers naming the entity (prompts that name it themselves are left out). */
  mentioned: Rate;
  /** Share of organic answers with visible sources that cite the entity's domain. */
  cited: Rate;
  avgPosition: number | null;
  positive: number;
  negative: number;
}

export interface EngineRow {
  engine: string;
  answers: number;
  youMentioned: Rate;
  youCited: Rate;
  topCompetitor: { name: string; answers: number } | null;
}

export interface PromptRow {
  id: string;
  text: string;
  intent: string;
  active: boolean;
  answers: number;
  youMentioned: number;
  youCited: number;
  engines: string[];
  enginesMissingYou: string[];
  competitors: Array<{ name: string; answers: number }>;
  /** Sources the engines cited when answering this prompt (excluding your own domain). */
  sources: Array<{ domain: string; answers: number; isCompetitor: boolean }>;
  status: "winning" | "shared" | "losing" | "nobody" | "no_data";
  /** The prompt names your brand (intent "direct" or brand name in the text); not part of headline rates. */
  branded: boolean;
}

export interface FailureSummary {
  /** Runs the engine refused (rate limit, sign-in wall, "unusual traffic"). */
  blocked: number;
  /** Runs not attempted because the engine was still blocking after cool-downs. */
  skipped: number;
  /** Pages that loaded without a readable answer, or errored. */
  noAnswer: number;
  /** Google searches that showed no AI Overview (a real outcome). */
  noOverview: number;
  byEngine: Record<string, { blocked: number; skipped: number; noAnswer: number; noOverview: number }>;
}

export interface Report {
  /** Answers counted in the headline rates: active, unbranded prompts. */
  totalAnswers: number;
  /** Every stored answer, including branded and paused prompts. */
  allAnswers: number;
  /** Organic answers whose capture exposes sources (citation-rate denominator). */
  answersWithSources: number;
  /** How often answers to branded prompts name you (separate from the organic headline). */
  branded: Rate;
  engines: EngineRow[];
  entities: EntityRow[];
  prompts: PromptRow[];
  topSources: Array<{ domain: string; answers: number; isBrand: boolean; isCompetitor: boolean }>;
  firstCapture: string | null;
  lastCapture: string | null;
  failedRuns: number;
  failures: FailureSummary;
}

export function rate(hits: number, n: number): Rate {
  if (n === 0) return { hits, n, pct: 0, low: 0, high: 0 };
  const [low, high] = MonteCarloMetricsCalculator.calculateWilsonInterval(hits, n);
  return { hits, n, pct: Math.round((hits / n) * 100), low: Math.round(low * 100), high: Math.round(high * 100) };
}

const escapeRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Name, aliases and the domain stem of an entity, lower-cased, for "does this prompt name it". */
function entityTerms(name: string, domain: string, aliasesJson: string | null): string[] {
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(aliasesJson || "[]");
  } catch {}
  const stem = normalizeDomain(domain).split(".")[0] || "";
  const generic = /\s+(ai|io|app|inc|hq|voice)$/i;
  return [...new Set([name, name.replace(generic, ""), ...aliases, stem].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 4))];
}

const namesAny = (text: string, terms: string[]) =>
  terms.some((t) => new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}([^a-z0-9]|$)`, "i").test(text));

export function buildReport(brand: BrandRecord): Report {
  const sqlite = getRawDb();
  const brandDomain = normalizeDomain(brand.domain);
  const allRuns = sqlite
    .prepare("SELECT id, prompt_id, engine, capture_method, created_at FROM prompt_runs WHERE brand_id = ? ORDER BY created_at")
    .all(brand.id) as Array<{ id: string; prompt_id: string; engine: string; capture_method: string; created_at: string }>;
  const prompts = sqlite
    .prepare("SELECT id, query_text, intent_type, active FROM prompts WHERE brand_id = ? ORDER BY created_at")
    .all(brand.id) as Array<{ id: string; query_text: string; intent_type: string; active: number }>;
  const competitors = sqlite.prepare("SELECT name, domain, aliases_json FROM competitors WHERE brand_id = ?").all(brand.id) as Array<{
    name: string;
    domain: string;
    aliases_json: string | null;
  }>;
  const mentions = sqlite
    .prepare("SELECT run_id, entity_name, is_target_brand, position_rank, sentiment FROM entity_mentions WHERE brand_id = ?")
    .all(brand.id) as Array<{ run_id: string; entity_name: string; is_target_brand: number; position_rank: number; sentiment: string }>;
  const citations = sqlite.prepare("SELECT run_id, domain FROM citations WHERE brand_id = ?").all(brand.id) as Array<{
    run_id: string;
    domain: string;
  }>;
  const batchRows = sqlite.prepare("SELECT failed_runs, errors_json FROM crawl_batches WHERE brand_id = ?").all(brand.id) as Array<{
    failed_runs: number;
    errors_json: string;
  }>;
  const failedRuns = batchRows.reduce((s, b) => s + Number(b.failed_runs || 0), 0);
  const failures: FailureSummary = { blocked: 0, skipped: 0, noAnswer: 0, noOverview: 0, byEngine: {} };
  for (const b of batchRows) {
    let list: Array<{ engine: string; kind: string }> = [];
    try {
      list = JSON.parse(b.errors_json || "[]");
    } catch {}
    for (const f of list) {
      const key = f.kind === "blocked" ? "blocked" : f.kind === "skipped_after_blocks" ? "skipped" : f.kind === "no_ai_overview" ? "noOverview" : f.kind === "unavailable" ? null : "noAnswer";
      if (!key) continue;
      failures[key]++;
      const e = (failures.byEngine[f.engine] ??= { blocked: 0, skipped: 0, noAnswer: 0, noOverview: 0 });
      e[key]++;
    }
  }

  // Headline rates use organic answers only: active prompts that do not name the brand
  const brandTerms = entityTerms(brand.name, brand.domain, brand.aliasesJson);
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const isBranded = (p: { query_text: string; intent_type: string }) => p.intent_type === "direct" || namesAny(p.query_text, brandTerms);
  const runs = allRuns.filter((r) => {
    const p = promptById.get(r.prompt_id);
    return p && p.active !== 0 && !isBranded(p);
  });
  const n = runs.length;

  const entityList = [
    { name: brand.name, domain: brandDomain, isTarget: true, terms: brandTerms },
    ...competitors.map((c) => ({ name: c.name, domain: normalizeDomain(c.domain), isTarget: false, terms: entityTerms(c.name, c.domain, c.aliases_json) })),
  ];
  const isCompetitorDomain = (d: string) => competitors.some((c) => domainMatches(d, c.domain));

  // An entity named in the prompt itself ("X alternatives") is an echo, not a recommendation
  const promptNames = new Map<string, Set<string>>(); // prompt -> entity names it contains
  for (const p of prompts) promptNames.set(p.id, new Set(entityList.filter((e) => namesAny(p.query_text, e.terms)).map((e) => e.name)));
  const promptOfRun = new Map(allRuns.map((r) => [r.id, r.prompt_id]));

  const mentionedBy = new Map<string, Set<string>>(); // run -> organically named entities
  const organicMentions = mentions.filter((m) => {
    const name = m.is_target_brand ? brand.name : m.entity_name;
    return !promptNames.get(promptOfRun.get(m.run_id) || "")?.has(name);
  });
  for (const m of organicMentions) {
    const name = m.is_target_brand ? brand.name : m.entity_name;
    if (!mentionedBy.has(m.run_id)) mentionedBy.set(m.run_id, new Set());
    mentionedBy.get(m.run_id)!.add(name);
  }
  const domainsBy = new Map<string, Set<string>>(); // run -> cited domains
  for (const c of citations) {
    if (!domainsBy.has(c.run_id)) domainsBy.set(c.run_id, new Set());
    domainsBy.get(c.run_id)!.add(normalizeDomain(c.domain));
  }
  const citesEntity = (runId: string, domain: string) => [...(domainsBy.get(runId) || [])].some((d) => domainMatches(d, domain));
  const names = (runId: string) => mentionedBy.get(runId) || new Set<string>();
  // Browser captures of some engines (Gemini) expose no sources, so they cannot count against citation rates
  const withSources = runs.filter((r) => (domainsBy.get(r.id)?.size || 0) > 0);

  const organicRunIds = new Set(runs.map((r) => r.id));
  const entities: EntityRow[] = entityList.map(({ terms: _terms, ...e }) => {
    const ms = organicMentions.filter(
      (m) => organicRunIds.has(m.run_id) && (e.isTarget ? m.is_target_brand : !m.is_target_brand && m.entity_name === e.name)
    );
    const mentionedRuns = new Set(ms.map((m) => m.run_id));
    const citedRuns = e.domain ? withSources.filter((r) => citesEntity(r.id, e.domain)).length : 0;
    return {
      ...e,
      mentioned: rate(mentionedRuns.size, n),
      cited: rate(citedRuns, withSources.length),
      avgPosition: ms.length ? +(ms.reduce((s, m) => s + m.position_rank, 0) / ms.length).toFixed(1) : null,
      positive: ms.filter((m) => m.sentiment === "positive").length,
      negative: ms.filter((m) => m.sentiment === "negative").length,
    };
  });
  entities.sort((a, b) => b.mentioned.hits - a.mentioned.hits || b.cited.hits - a.cited.hits || Number(b.isTarget) - Number(a.isTarget));

  const engineIds = [...new Set(runs.map((r) => r.engine))];
  const engines: EngineRow[] = engineIds.map((engine) => {
    const er = runs.filter((r) => r.engine === engine);
    const erSources = er.filter((r) => (domainsBy.get(r.id)?.size || 0) > 0);
    const compCounts = competitors
      .map((c) => ({ name: c.name, answers: er.filter((r) => names(r.id).has(c.name)).length }))
      .filter((c) => c.answers > 0)
      .sort((a, b) => b.answers - a.answers);
    return {
      engine,
      answers: er.length,
      youMentioned: rate(er.filter((r) => names(r.id).has(brand.name)).length, er.length),
      youCited: rate(brandDomain ? erSources.filter((r) => citesEntity(r.id, brandDomain)).length : 0, erSources.length),
      topCompetitor: compCounts[0] || null,
    };
  });

  const brandedRuns = allRuns.filter((r) => {
    const p = promptById.get(r.prompt_id);
    return p && p.active !== 0 && isBranded(p);
  });
  const brandedNamed = brandedRuns.filter((r) => mentions.some((m) => m.run_id === r.id && m.is_target_brand)).length;

  const promptRows: PromptRow[] = prompts.map((p) => {
    const pr = allRuns.filter((r) => r.prompt_id === p.id);
    const youMentioned = pr.filter((r) => names(r.id).has(brand.name)).length;
    const youCited = brandDomain ? pr.filter((r) => citesEntity(r.id, brandDomain)).length : 0;
    const comps = competitors
      .map((c) => ({ name: c.name, answers: pr.filter((r) => names(r.id).has(c.name)).length }))
      .filter((c) => c.answers > 0)
      .sort((a, b) => b.answers - a.answers);
    const sourceCounts = new Map<string, number>();
    for (const r of pr) for (const d of domainsBy.get(r.id) || []) if (!domainMatches(d, brandDomain)) sourceCounts.set(d, (sourceCounts.get(d) || 0) + 1);
    const engines = [...new Set(pr.map((r) => r.engine))];
    const enginesMissingYou = engines.filter((e) => !pr.some((r) => r.engine === e && names(r.id).has(brand.name)));
    const topComp = comps[0]?.answers || 0;
    const status: PromptRow["status"] =
      pr.length === 0 ? "no_data" : youMentioned === 0 && topComp === 0 ? "nobody" : youMentioned === 0 ? "losing" : youMentioned >= topComp ? "winning" : "shared";
    return {
      id: p.id,
      text: p.query_text,
      intent: p.intent_type,
      active: p.active !== 0,
      answers: pr.length,
      youMentioned,
      youCited,
      engines,
      enginesMissingYou,
      competitors: comps,
      sources: [...sourceCounts.entries()]
        .map(([domain, answers]) => ({ domain, answers, isCompetitor: isCompetitorDomain(domain) }))
        .sort((a, b) => b.answers - a.answers)
        .slice(0, 6),
      status,
      branded: isBranded(p),
    };
  });

  const sourceCounts = new Map<string, number>();
  for (const r of runs) for (const d of domainsBy.get(r.id) || []) sourceCounts.set(d, (sourceCounts.get(d) || 0) + 1);
  const topSources = [...sourceCounts.entries()]
    .map(([domain, answers]) => ({ domain, answers, isBrand: domainMatches(domain, brandDomain), isCompetitor: isCompetitorDomain(domain) }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 10);

  return {
    totalAnswers: n,
    allAnswers: allRuns.length,
    answersWithSources: withSources.length,
    branded: rate(brandedNamed, brandedRuns.length),
    engines: engines.sort((a, b) => b.answers - a.answers),
    entities,
    prompts: promptRows,
    topSources,
    firstCapture: allRuns[0]?.created_at ?? null,
    lastCapture: allRuns[allRuns.length - 1]?.created_at ?? null,
    failedRuns,
    failures,
  };
}

export interface Opportunity {
  prompt: PromptRow;
  priority: "high" | "medium" | "low";
  headline: string;
  actions: string[];
}

/**
 * Prompts where you are absent or behind, ranked by how many answers a competitor won, each with
 * concrete next steps drawn from what the engines actually cited for that question.
 */
export function findOpportunities(report: Report, brandName: string): Opportunity[] {
  const out: Opportunity[] = [];
  for (const p of report.prompts) {
    if (p.status === "winning" || p.status === "no_data" || !p.active || p.branded) continue;
    const leader = p.competitors[0];
    const editorial = p.sources.filter((s) => !s.isCompetitor).slice(0, 3).map((s) => s.domain);
    const actions: string[] = [];
    if (editorial.length) actions.push(`Get ${brandName} covered on the sources the engines cite here: ${editorial.join(", ")}`);
    if (leader) actions.push(`Publish a direct comparison or answer page for this question; ${leader.name} is named in ${leader.answers} of ${p.answers} answers`);
    else actions.push("Publish a page that answers this exact question; no tracked vendor is named yet, so it is open ground");
    if (p.enginesMissingYou.length) actions.push(`Re-check after publishing on: ${p.enginesMissingYou.map((e) => ENGINE_LABELS[e] || e).join(", ")}`);
    const headline =
      p.status === "losing"
        ? `${leader?.name} is named, ${brandName} is not`
        : p.status === "shared"
          ? `${leader?.name} is named more often than ${brandName}`
          : `No tracked vendor is named yet`;
    const priority: Opportunity["priority"] = p.status === "losing" ? "high" : p.status === "shared" ? "medium" : "low";
    out.push({ prompt: p, priority, headline, actions });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.priority] - order[b.priority] || (b.prompt.competitors[0]?.answers || 0) - (a.prompt.competitors[0]?.answers || 0));
}
