import { entityTerms, isGenericHost, namesEntity } from "../text/mentions";
import { domainMatches, hostKey } from "../url/canonical";
import { clusteredRate, wilsonInterval, type PromptCluster } from "../metrics/visibility-stats";
import { competitorMatcher } from "../parser/reverse-rag";

/**
 * The visibility report: one measured picture of a brand's AI-search visibility, computed from
 * stored rows only (load them with `loadReportInput()` from @prismgeo/db). Used by the dashboard
 * (apps/web/src/lib/report.ts) and meant for every other consumer (MCP), so numbers never differ
 * between surfaces. The field-by-field contract is documented at the top of apps/web/src/lib/report.ts.
 */

export const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google_aio: "Google AI Overviews",
  copilot: "Copilot",
};

/** How each capture method is named in the dashboard and reports. */
export const CAPTURE_METHOD_LABELS: Record<string, string> = {
  browser: "Browser",
  browser_signed_in: "Signed-in browser",
  api: "API",
  provider: "Data provider",
  manual: "Captured by hand",
};

export interface Rate {
  /** Answers that hit (raw count). */
  hits: number;
  /** Answers counted (raw count). */
  n: number;
  /** Rate in percent: the mean over questions of each question's hit share (equals hits/n with one answer per question). */
  pct: number;
  /** 95% interval in percent: Wilson on the prompt-clustered effective sample size. */
  low: number;
  high: number;
  /** Questions (prompts) behind the answers; the unit the interval is about. */
  questions?: number;
  /** Effective sample size after accounting for answers to the same question being correlated. */
  nEff?: number;
}

export interface EntityRow {
  name: string;
  domain: string;
  isTarget: boolean;
  /** Share of organic answers naming the entity; prompts that name the entity themselves are excluded from its own denominator. */
  mentioned: Rate;
  /** Share of organic answers with visible sources that cite the entity's domain (same per-entity exclusion). */
  cited: Rate;
  /** Mean rank among tracked vendors (echoes have no rank). */
  avgPosition: number | null;
  positive: number;
  negative: number;
  /** Competitor id, or "brand" for the target. Set by buildVisibilityReport. */
  id?: string;
  /** Mean list/table position when the answer was a list. */
  avgListPosition?: number | null;
  /** Mentions recommended but with a caveat attached. */
  caveats?: number;
  /** Mean of per-engine mention rates (percent) over engines covering >= 50% of questions; null if none does. */
  mentionedStratified?: number | null;
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
  /** Answers naming you. On branded prompts this counts the brand's presence even though the prompt names it. */
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
  /** Branded prompts only: answers that name the brand at all (echo included); null for unbranded prompts. */
  brandedNamedRuns?: number | null;
}

export interface FailureCounts {
  blocked: number;
  skipped: number;
  noAnswer: number;
  noOverview: number;
  /** Could not connect (proxy, DNS, offline), incl. runs skipped after repeated network failures. */
  network?: number;
  /** Browser or engine not installed / not set up, incl. runs skipped because of it. */
  setup?: number;
  /** Prompt paused or deleted while the batch was running (not an engine failure). */
  promptRemoved?: number;
}

export interface FailureSummary {
  /** Runs the engine refused (rate limit, sign-in wall, "unusual traffic"). */
  blocked: number;
  /** Runs not attempted because the engine was still blocking after cool-downs. */
  skipped: number;
  /** Pages that loaded without a readable answer, truncated answers, or other engine errors. */
  noAnswer: number;
  /** Google searches that showed no AI Overview (a real outcome). */
  noOverview: number;
  /** Connection failures on this machine's side (not the engine's). */
  network: number;
  /** Setup problems (browser not installed). */
  setup: number;
  /** Runs skipped because the prompt was paused or deleted mid-batch. */
  promptRemoved: number;
  byEngine: Record<string, FailureCounts>;
}

export interface EngineCoverage {
  engine: string;
  /** Active unbranded prompts this engine answered at least once. */
  promptsCovered: number;
  /** Active unbranded prompts. */
  activeUnbrandedPrompts: number;
  /** promptsCovered / activeUnbrandedPrompts, 0..1. */
  share: number;
  /** Included in the engine-stratified headline (share >= 0.5). */
  inHeadline: boolean;
  byIntent: Record<string, { covered: number; total: number }>;
}

export interface CaptureMethodSplit {
  engine: string;
  total: number;
  /** Answers per capture method ("browser", "browser_signed_in", "api", "provider", "manual"). */
  byMethod: Record<string, number>;
  dominant: string;
  /** More than 20% of this engine's answers came from a non-dominant method (populations are mixed). */
  mixed: boolean;
}

export interface AioTrigger {
  /** Google searches that showed an AI Overview (stored AIO answers on active prompts). */
  overviews: number;
  /** Google searches that showed no AI Overview. */
  noOverview: number;
  /** overviews / (overviews + noOverview), plain Wilson interval. */
  rate: Rate;
}

export interface StratifiedHeadline {
  /** Engines whose coverage of active unbranded prompts is >= 50%. */
  engines: string[];
  /** Engines left out, with their coverage share (0..1). */
  excluded: Array<{ engine: string; share: number }>;
  /** Mean of per-engine brand mention rates over the included engines, in percent (null if none). */
  brandMentionedPct: number | null;
  /** Mean of per-engine brand citation rates over the included engines, in percent (null if none). */
  brandCitedPct: number | null;
}

/** Answers tailored to the location PrismGEO ran from instead of the measured market (flags_json.localisedTo). */
export interface Localisation {
  /** Answers (active prompts) flagged, all engines. */
  localisedAnswers: number;
  byEngine: Array<{ engine: string; answers: number; localised: number; places: Record<string, number> }>;
}

export interface BrandAccuracy {
  /** Answers (active prompts) that name the brand. */
  answersNamingBrand: number;
  /** Answers that cite or name a look-alike of the brand's domain. */
  confusedAnswers: number;
  /** Answers to branded prompts, and how many of them were confused. */
  brandedAnswers: number;
  confusedBrandedAnswers: number;
  /** confusedAnswers / answersNamingBrand (plain Wilson). */
  confusionRate: Rate;
  lookalikeDomains: Array<{ domain: string; answers: number }>;
  examples: Array<{ runId: string; promptId: string; prompt: string; engine: string; domains: string[]; capturedAt: string }>;
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
  /** Active unbranded prompts (the questions behind the headline). */
  totalQuestions: number;
  coverage: EngineCoverage[];
  captureMethods: CaptureMethodSplit[];
  aioTrigger: AioTrigger;
  headline: StratifiedHeadline;
  brandAccuracy: BrandAccuracy;
  localisation: Localisation;
  /** Same shape as `entities`, restricted to one engine's answers. */
  entitiesByEngine: Record<string, EntityRow[]>;
}

export interface ReportInput {
  brand: { id: string; name: string; domain: string; aliasesJson: string | null };
  runs: Array<{ id: string; prompt_id: string; engine: string; capture_method: string; created_at: string; flags_json?: string | null }>;
  prompts: Array<{ id: string; query_text: string; intent_type: string; active: number }>;
  /** Active competitors. */
  competitors: Array<{ id: string; name: string; domain: string; aliases_json: string | null }>;
  mentions: Array<{
    run_id: string;
    entity_name: string;
    competitor_id?: string | null;
    is_target_brand: number;
    is_prompt_subject?: number | null;
    position_rank: number | null;
    list_position?: number | null;
    sentiment: string;
    stance?: string | null;
    has_caveat?: number | null;
    entity_confusion?: number | null;
  }>;
  /** Cited domain and (optionally) URL; the URL lets marketplace listings ("apps.shopify.com/x") be attributed. */
  citations: Array<{ run_id: string; domain: string; url?: string | null }>;
  batches: Array<{ failed_runs: number; errors_json: string }>;
}

/** Plain Wilson rate (answers treated as independent). */
export function rate(hits: number, n: number): Rate {
  if (n === 0) return { hits, n, pct: 0, low: 0, high: 0, questions: 0, nEff: 0 };
  const [low, high] = wilsonInterval(hits, n);
  return { hits, n, pct: Math.round((hits / n) * 100), low: Math.round(low * 100), high: Math.round(high * 100), questions: n, nEff: n };
}

/** Prompt-clustered rate from per-prompt clusters. */
export function clusteredRateOf(clusters: PromptCluster[]): Rate {
  const c = clusteredRate(clusters);
  if (c.answers === 0) return { hits: 0, n: 0, pct: 0, low: 0, high: 0, questions: 0, nEff: 0 };
  return { hits: c.hits, n: c.answers, pct: Math.round(c.p * 100), low: Math.round(c.low * 100), high: Math.round(c.high * 100), questions: c.questions, nEff: c.nEff };
}

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const BRAND_KEY = "brand";

const FAILURE_BUCKET: Record<string, keyof FailureCounts | null> = {
  blocked: "blocked",
  skipped_after_blocks: "skipped",
  no_ai_overview: "noOverview",
  no_answer: "noAnswer",
  error: "noAnswer",
  api_key_rejected: "noAnswer",
  network: "network",
  skipped_after_network: "network",
  setup: "setup",
  skipped_setup: "setup",
  prompt_removed: "promptRemoved",
  prompt_paused: "promptRemoved",
  unavailable: null,
};

export function buildVisibilityReport(input: ReportInput): Report {
  const { brand } = input;
  const brandDomain = hostKey(brand.domain);
  const allRuns = input.runs;

  // ---- failures
  const failedRuns = input.batches.reduce((s, b) => s + Number(b.failed_runs || 0), 0);
  const failures: FailureSummary = { blocked: 0, skipped: 0, noAnswer: 0, noOverview: 0, network: 0, setup: 0, promptRemoved: 0, byEngine: {} };
  for (const b of input.batches) {
    for (const f of parseJson<Array<{ engine: string; kind: string }>>(b.errors_json, [])) {
      const key = f.kind in FAILURE_BUCKET ? FAILURE_BUCKET[f.kind] : "noAnswer";
      if (!key) continue;
      failures[key]++;
      const e = (failures.byEngine[f.engine] ??= { blocked: 0, skipped: 0, noAnswer: 0, noOverview: 0, network: 0, setup: 0, promptRemoved: 0 });
      e[key] = (e[key] || 0) + 1;
    }
  }

  // ---- entities and which prompts name them (one shared term implementation)
  const entityList = [
    { key: BRAND_KEY, name: brand.name, domain: brandDomain, isTarget: true, terms: entityTerms(brand.name, parseJson<string[]>(brand.aliasesJson, []), brand.domain) },
    ...input.competitors.map((c) => ({
      key: c.id,
      name: c.name,
      domain: hostKey(c.domain),
      isTarget: false,
      terms: entityTerms(c.name, parseJson<string[]>(c.aliases_json, []), c.domain),
    })),
  ];
  const competitorList = entityList.filter((e) => !e.isTarget);
  const keyByName = new Map(competitorList.map((e) => [e.name, e.key]));
  const competitorIds = new Set(competitorList.map((e) => e.key));
  const promptById = new Map(input.prompts.map((p) => [p.id, p]));
  const promptNames = new Map<string, Set<string>>();
  for (const p of input.prompts) promptNames.set(p.id, new Set(entityList.filter((e) => namesEntity(p.query_text, e.terms)).map((e) => e.key)));
  const names = (promptId: string, key: string) => promptNames.get(promptId)?.has(key) ?? false;
  const isBranded = (p: { id: string; intent_type: string }) => p.intent_type === "direct" || names(p.id, BRAND_KEY);
  const isActive = (p: { active: number } | undefined) => !!p && p.active !== 0;

  // ---- index everything once: runs, prompts and entities become integers, per-run facts typed arrays
  const E = entityList.length;
  const P = input.prompts.length;
  const R = allRuns.length;
  const promptIndex = new Map(input.prompts.map((p, i) => [p.id, i]));
  const entityIndex = new Map(entityList.map((e, i) => [e.key, i]));
  const promptNamed = new Uint8Array(P * E); // prompt names entity (echo)
  input.prompts.forEach((p, pi) => entityList.forEach((e, ei) => (promptNamed[pi * E + ei] = names(p.id, e.key) ? 1 : 0)));
  const promptBranded = input.prompts.map((p) => isBranded(p));
  const promptActive = input.prompts.map((p) => isActive(p));

  const runIndex = new Map<string, number>();
  const runPrompt = new Int32Array(R).fill(-1);
  const organic: number[] = [];
  const activeRuns: number[] = [];
  const runsByPrompt: number[][] = input.prompts.map(() => []);
  allRuns.forEach((r, i) => {
    runIndex.set(r.id, i);
    const pi = promptIndex.get(r.prompt_id);
    if (pi === undefined) return;
    runPrompt[i] = pi;
    runsByPrompt[pi].push(i);
    if (!promptActive[pi]) return;
    activeRuns.push(i);
    if (!promptBranded[pi]) organic.push(i);
  });
  const named = (ri: number, ei: number) => runPrompt[ri] >= 0 && promptNamed[runPrompt[ri] * E + ei] === 1;

  // ---- mentions and citations as per-run facts
  type MentionRow = ReportInput["mentions"][number];
  const keyOf = (m: MentionRow): string | undefined =>
    m.is_target_brand ? BRAND_KEY : m.competitor_id && competitorIds.has(m.competitor_id) ? m.competitor_id : keyByName.get(m.entity_name);
  const organicHit = new Uint8Array(R * E); // the answer names the entity, and it is not an echo
  const anyHit = new Uint8Array(R * E); // the answer names the entity (echoes included)
  const mentionsByEntity: Array<Array<{ ri: number; m: MentionRow }>> = entityList.map(() => []);
  for (const m of input.mentions) {
    const key = keyOf(m);
    const ri = runIndex.get(m.run_id);
    if (key === undefined || ri === undefined) continue;
    const ei = entityIndex.get(key)!;
    anyHit[ri * E + ei] = 1;
    const echo = m.is_prompt_subject === null || m.is_prompt_subject === undefined ? named(ri, ei) : Boolean(m.is_prompt_subject);
    if (echo || named(ri, ei)) continue;
    organicHit[ri * E + ei] = 1;
    mentionsByEntity[ei].push({ ri, m });
  }
  const domainsBy: Array<string[] | undefined> = new Array(R);
  const citedHit = new Uint8Array(R * E);
  const matchers = entityList.map((e) => competitorMatcher(e.key === BRAND_KEY ? brand.domain : input.competitors.find((c) => c.id === e.key)!.domain));
  const matchedEntities = new Map<string, number[]>();
  const hostKeys = new Map<string, string>();
  for (const c of input.citations) {
    const ri = runIndex.get(c.run_id);
    if (ri === undefined) continue;
    let d = hostKeys.get(c.domain);
    if (d === undefined) hostKeys.set(c.domain, (d = hostKey(c.domain)));
    const list = (domainsBy[ri] ??= []);
    if (!list.includes(d)) list.push(d);
    const url = c.url || `https://${c.domain}/`;
    let eis = matchedEntities.get(url);
    if (!eis) {
      eis = [];
      for (let ei = 0; ei < E; ei++) if (matchers[ei](url)) eis.push(ei);
      matchedEntities.set(url, eis);
    }
    for (const ei of eis) citedHit[ri * E + ei] = 1;
  }
  /** Entities whose configured domain can be attributed at all (not a bare marketplace host). */
  const citable = new Set(entityList.filter((e) => e.domain && !isGenericHost(e.domain)).map((e) => e.key));
  for (const c of input.competitors) if (/\/./.test(c.domain.replace(/^[a-z]+:\/\//i, ""))) citable.add(c.id);
  const hasSources = (ri: number) => (domainsBy[ri]?.length || 0) > 0;

  /** Entity rows over a set of runs, in one pass: per-entity eligibility, per-question clusters, mention stats. */
  const entityRows = (runs: number[]): EntityRow[] => {
    const inScope = new Uint8Array(R);
    const mHits = new Int32Array(P * E);
    const mRuns = new Int32Array(P * E);
    const cHits = new Int32Array(P * E);
    const cRuns = new Int32Array(P * E);
    for (const ri of runs) {
      inScope[ri] = 1;
      const pi = runPrompt[ri];
      const src = hasSources(ri);
      for (let ei = 0; ei < E; ei++) {
        if (promptNamed[pi * E + ei]) continue; // a prompt that names the entity cannot count for it
        const k = pi * E + ei;
        mRuns[k]++;
        if (organicHit[ri * E + ei]) mHits[k]++;
        if (src) {
          cRuns[k]++;
          if (citedHit[ri * E + ei]) cHits[k]++;
        }
      }
    }
    const clustersOf = (hits: Int32Array, runsArr: Int32Array, ei: number): PromptCluster[] => {
      const out: PromptCluster[] = [];
      for (let pi = 0; pi < P; pi++) if (runsArr[pi * E + ei] > 0) out.push({ hits: hits[pi * E + ei], runs: runsArr[pi * E + ei] });
      return out;
    };
    const avg = (xs: number[]) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : null);
    const rows = entityList.map((e, ei) => {
      const ms = mentionsByEntity[ei].filter((x) => inScope[x.ri]).map((x) => x.m);
      return {
        id: e.key,
        name: e.name,
        domain: e.domain,
        isTarget: e.isTarget,
        mentioned: clusteredRateOf(clustersOf(mHits, mRuns, ei)),
        cited: citable.has(e.key) ? clusteredRateOf(clustersOf(cHits, cRuns, ei)) : rate(0, 0),
        avgPosition: avg(ms.filter((m) => m.position_rank !== null && m.position_rank !== undefined).map((m) => Number(m.position_rank))),
        avgListPosition: avg(ms.filter((m) => m.list_position !== null && m.list_position !== undefined).map((m) => Number(m.list_position))),
        positive: ms.filter((m) => m.sentiment === "positive").length,
        negative: ms.filter((m) => m.sentiment === "negative").length,
        caveats: ms.filter((m) => m.sentiment === "positive" && Number(m.has_caveat) === 1).length,
        mentionedStratified: null as number | null,
      };
    });
    return rows.sort((a, b) => b.mentioned.hits - a.mentioned.hits || b.cited.hits - a.cited.hits || Number(b.isTarget) - Number(a.isTarget));
  };

  // ---- engines, coverage and the stratified headline
  const organicByEngine = new Map<string, number[]>();
  for (const ri of organic) {
    const engine = allRuns[ri].engine;
    (organicByEngine.get(engine) ?? organicByEngine.set(engine, []).get(engine)!).push(ri);
  }
  const engineIds = [...organicByEngine.keys()];
  const entitiesByEngine: Record<string, EntityRow[]> = {};
  for (const engine of engineIds) entitiesByEngine[engine] = entityRows(organicByEngine.get(engine)!);

  const unbrandedActive = input.prompts.filter((_, pi) => promptActive[pi] && !promptBranded[pi]);
  const totalQuestions = unbrandedActive.length;
  const intentTotals: Record<string, number> = {};
  for (const p of unbrandedActive) intentTotals[p.intent_type] = (intentTotals[p.intent_type] || 0) + 1;
  const coverage: EngineCoverage[] = engineIds.map((engine) => {
    const covered = new Set(organicByEngine.get(engine)!.map((ri) => runPrompt[ri]));
    const byIntent: EngineCoverage["byIntent"] = {};
    for (const [intent, total] of Object.entries(intentTotals)) byIntent[intent] = { covered: 0, total };
    for (const pi of covered) byIntent[input.prompts[pi].intent_type].covered++;
    const share = totalQuestions ? covered.size / totalQuestions : 0;
    return { engine, promptsCovered: covered.size, activeUnbrandedPrompts: totalQuestions, share: Number(share.toFixed(3)), inHeadline: share >= 0.5, byIntent };
  });
  const included = coverage.filter((c) => c.inHeadline).map((c) => c.engine);
  const meanOf = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

  const entities = entityRows(organic);
  for (const e of entities) {
    e.mentionedStratified = meanOf(included.map((engine) => entitiesByEngine[engine].find((x) => x.id === e.id)!.mentioned.pct));
  }
  const brandIn = (engine: string) => entitiesByEngine[engine].find((x) => x.id === BRAND_KEY)!;
  const headline: StratifiedHeadline = {
    engines: included,
    excluded: coverage.filter((c) => !c.inHeadline).map((c) => ({ engine: c.engine, share: c.share })),
    brandMentionedPct: meanOf(included.map((engine) => brandIn(engine).mentioned.pct)),
    brandCitedPct: meanOf(included.filter((engine) => brandIn(engine).cited.n > 0).map((engine) => brandIn(engine).cited.pct)),
  };

  const BRAND = entityIndex.get(BRAND_KEY)!;
  const competitorIdx = competitorList.map((c) => ({ name: c.name, key: c.key, ei: entityIndex.get(c.key)! }));
  const countBy = (runs: number[], ei: number, facts: Uint8Array) => {
    let n = 0;
    for (const ri of runs) if (facts[ri * E + ei]) n++;
    return n;
  };
  const engines: EngineRow[] = engineIds.map((engine) => {
    const er = organicByEngine.get(engine)!;
    const brandRow = brandIn(engine);
    const compCounts = competitorIdx
      .map((c) => ({ name: c.name, answers: countBy(er, c.ei, organicHit) }))
      .filter((c) => c.answers > 0)
      .sort((a, b) => b.answers - a.answers);
    return { engine, answers: er.length, youMentioned: brandRow.mentioned, youCited: brandRow.cited, topCompetitor: compCounts[0] || null };
  });

  const methodsByEngine = new Map<string, Record<string, number>>();
  for (const ri of activeRuns) {
    const r = allRuns[ri];
    const byMethod = methodsByEngine.get(r.engine) ?? methodsByEngine.set(r.engine, {}).get(r.engine)!;
    const m = r.capture_method || "browser";
    byMethod[m] = (byMethod[m] || 0) + 1;
  }
  const captureMethods: CaptureMethodSplit[] = [...methodsByEngine.entries()].map(([engine, byMethod]) => {
    const total = Object.values(byMethod).reduce((s, n) => s + n, 0);
    const [dominant, top] = Object.entries(byMethod).sort((a, b) => b[1] - a[1])[0];
    return { engine, total, byMethod, dominant, mixed: total > 0 && (total - top) / total > 0.2 };
  });

  const overviews = activeRuns.filter((ri) => allRuns[ri].engine === "google_aio").length;
  const noOverview = failures.byEngine.google_aio?.noOverview || 0;
  const aioTrigger: AioTrigger = { overviews, noOverview, rate: rate(overviews, overviews + noOverview) };

  // ---- branded presence and brand accuracy
  const brandedRuns = activeRuns.filter((ri) => promptBranded[runPrompt[ri]]);
  const brandPresent = (ri: number) => anyHit[ri * E + BRAND] === 1;
  const lookalikeOf = (ri: number): string[] => {
    const f = allRuns[ri].flags_json;
    if (!f || f === "{}") return [];
    return parseJson<{ entityConfusion?: { lookalikeDomains?: string[] } }>(f, {}).entityConfusion?.lookalikeDomains || [];
  };
  const confused = activeRuns.filter((ri) => lookalikeOf(ri).length > 0);
  const confusedSet = new Set(confused);
  const lookalikeCounts = new Map<string, number>();
  for (const ri of confused) for (const d of lookalikeOf(ri)) lookalikeCounts.set(d, (lookalikeCounts.get(d) || 0) + 1);
  const namingBrand = activeRuns.filter(brandPresent);
  const brandAccuracy: BrandAccuracy = {
    answersNamingBrand: namingBrand.length,
    confusedAnswers: confused.length,
    brandedAnswers: brandedRuns.length,
    confusedBrandedAnswers: brandedRuns.filter((ri) => confusedSet.has(ri)).length,
    confusionRate: rate(namingBrand.filter((ri) => confusedSet.has(ri)).length, namingBrand.length),
    lookalikeDomains: [...lookalikeCounts.entries()].map(([domain, answers]) => ({ domain, answers })).sort((a, b) => b.answers - a.answers),
    examples: confused
      .slice(-5)
      .reverse()
      .map((ri) => {
        const r = allRuns[ri];
        return { runId: r.id, promptId: r.prompt_id, prompt: input.prompts[runPrompt[ri]]?.query_text || "", engine: r.engine, domains: lookalikeOf(ri), capturedAt: r.created_at };
      }),
  };

  // ---- localisation: answers tailored to where the crawler ran
  const locByEngine = new Map<string, { engine: string; answers: number; localised: number; places: Record<string, number> }>();
  for (const ri of activeRuns) {
    const r = allRuns[ri];
    const row = locByEngine.get(r.engine) ?? { engine: r.engine, answers: 0, localised: 0, places: {} };
    row.answers++;
    const place = r.flags_json && r.flags_json !== "{}" ? parseJson<{ localisedTo?: string }>(r.flags_json, {}).localisedTo : undefined;
    if (place) {
      row.localised++;
      row.places[place] = (row.places[place] || 0) + 1;
    }
    locByEngine.set(r.engine, row);
  }
  const localisation: Localisation = {
    localisedAnswers: [...locByEngine.values()].reduce((n, e) => n + e.localised, 0),
    byEngine: [...locByEngine.values()].sort((a, b) => b.localised - a.localised),
  };

  // ---- prompt rows
  const memo = <T>(fn: (d: string) => T) => {
    const cache = new Map<string, T>();
    return (d: string) => {
      let v = cache.get(d);
      if (v === undefined) cache.set(d, (v = fn(d)));
      return v;
    };
  };
  const isCompetitorDomain = memo((d) => competitorList.some((c) => citable.has(c.key) && domainMatches(d, c.domain)));
  const isBrandDomain = memo((d) => domainMatches(d, brandDomain));
  const promptRows: PromptRow[] = input.prompts.map((p, pi) => {
    const pr = runsByPrompt[pi];
    const branded = promptBranded[pi];
    const you = (ri: number) => (branded ? brandPresent(ri) : organicHit[ri * E + BRAND] === 1);
    const youMentioned = pr.filter(you).length;
    const youCited = brandDomain ? countBy(pr, BRAND, citedHit) : 0;
    const comps = competitorIdx
      .map((c) => ({ name: c.name, answers: countBy(pr, c.ei, organicHit) }))
      .filter((c) => c.answers > 0)
      .sort((a, b) => b.answers - a.answers);
    const sourceCounts = new Map<string, number>();
    for (const ri of pr) for (const d of domainsBy[ri] || []) if (!isBrandDomain(d)) sourceCounts.set(d, (sourceCounts.get(d) || 0) + 1);
    const engines = [...new Set(pr.map((ri) => allRuns[ri].engine))];
    const enginesMissingYou = engines.filter((e) => !pr.some((ri) => allRuns[ri].engine === e && you(ri)));
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
      branded,
      brandedNamedRuns: branded ? pr.filter(brandPresent).length : null,
    };
  });

  const sourceCounts = new Map<string, number>();
  for (const ri of organic) for (const d of domainsBy[ri] || []) sourceCounts.set(d, (sourceCounts.get(d) || 0) + 1);
  const topSources = [...sourceCounts.entries()]
    .map(([domain, answers]) => ({ domain, answers, isBrand: isBrandDomain(domain), isCompetitor: isCompetitorDomain(domain) }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 10);

  const brandedClusters = new Map<number, PromptCluster>();
  for (const ri of brandedRuns) {
    const c = brandedClusters.get(runPrompt[ri]) ?? brandedClusters.set(runPrompt[ri], { hits: 0, runs: 0 }).get(runPrompt[ri])!;
    c.runs++;
    if (brandPresent(ri)) c.hits++;
  }

  return {
    totalAnswers: organic.length,
    allAnswers: allRuns.length,
    answersWithSources: organic.filter(hasSources).length,
    branded: clusteredRateOf([...brandedClusters.values()]),
    engines: engines.sort((a, b) => b.answers - a.answers),
    entities,
    prompts: promptRows,
    topSources,
    firstCapture: allRuns[0]?.created_at ?? null,
    lastCapture: allRuns[allRuns.length - 1]?.created_at ?? null,
    failedRuns,
    failures,
    totalQuestions,
    coverage,
    captureMethods,
    aioTrigger,
    headline,
    brandAccuracy,
    localisation,
    entitiesByEngine,
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
