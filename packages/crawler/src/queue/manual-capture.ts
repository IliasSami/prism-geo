import crypto from "node:crypto";
import { getRawDb, nowIso, rowToBrand, type BrandRecord } from "@prismgeo/db";
import { ENGINE_IDS, entityTerms } from "@prismgeo/core";
import { assertRealAnswer, cleanCitationUrl } from "../engines/browser-session";
import type { CrawlEntity } from "./crawler-orchestrator";

/**
 * Answers a person captured with the PrismGEO capture extension: they asked the question in their
 * own ChatGPT / Gemini / Perplexity / Google account and clicked "Save to PrismGEO". Nothing is
 * automated, so this route is free and within every service's terms. The answer goes through the
 * same checks and storage as a crawled one (real-answer check, citations, passages, mentions,
 * stance, brand look-alikes) and is stored with capture_method = 'manual'.
 *
 * Captures of a client on one day share a batch owned by MANUAL_BATCH_OWNER. Those batches are
 * completed immediately and are left out of engine health and "latest audit", so one saved answer
 * never makes a blocked engine look healthy.
 */
export const MANUAL_BATCH_OWNER = "manual-capture";
/** SQL condition that leaves hand-capture batches out (for health and latest-audit queries). */
export const NOT_MANUAL_BATCH = `COALESCE(owner, '') <> '${MANUAL_BATCH_OWNER}'`;

export const MANUAL_ENGINES = ENGINE_IDS;
export type ManualEngine = (typeof MANUAL_ENGINES)[number];

/** The brand and its active competitors as the crawler tracks them. */
export function trackedEntitiesFor(brand: BrandRecord): { entities: CrawlEntity[]; competitorDomains: string[] } {
  const competitors = (
    getRawDb()
      .prepare("SELECT id, name, domain, aliases_json FROM competitors WHERE brand_id = ? AND active = 1 ORDER BY created_at")
      .all(brand.id) as Array<{ id: string; name: string; domain: string; aliases_json: string | null }>
  ).filter((c) => c.name?.trim());
  const aliases: string[] = JSON.parse(brand.aliasesJson || "[]").filter((a: unknown) => typeof a === "string" && a.trim());
  return {
    competitorDomains: competitors.map((c) => c.domain),
    entities: [
      { key: "brand", competitorId: null, name: brand.name, isTarget: true, terms: entityTerms(brand.name, aliases, brand.domain) },
      ...competitors.map((c) => ({
        key: c.id,
        competitorId: c.id,
        name: c.name,
        isTarget: false,
        terms: entityTerms(c.name, JSON.parse(c.aliases_json || "[]"), c.domain),
      })),
    ],
  };
}

/** Comparable form of a question: case, quotes, punctuation and spacing do not matter. */
export function normalizeQuestion(q: string): string {
  return (q || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^\p{L}\p{N}$%+&]+/gu, " ")
    .trim();
}

const words = (q: string) => new Set(normalizeQuestion(q).split(" ").filter((w) => w.length > 1));

/** Tracked questions ranked by word overlap with `question` (Jaccard), best first; for the picker. */
export function rankPromptMatches<T extends { id: string; text: string }>(question: string, prompts: T[], limit = 5): Array<T & { score: number }> {
  const q = words(question);
  if (q.size === 0) return [];
  return prompts
    .map((p) => {
      const w = words(p.text);
      let shared = 0;
      for (const x of w) if (q.has(x)) shared++;
      const union = q.size + w.size - shared;
      return { ...p, score: union ? +(shared / union).toFixed(3) : 0 };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export class CaptureRejectedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface ManualCaptureInput {
  brandId: string;
  engine: ManualEngine;
  /** The tracked question this answers; when absent, `question` must match one exactly (normalized). */
  promptId?: string;
  /** The question as the person typed it in the engine. */
  question?: string;
  /** Add `question` as a new tracked question when it matches none. */
  addAsPrompt?: boolean;
  /** Intent for a question added this way (default "category"). */
  intent?: string;
  answerText: string;
  citations: Array<{ url: string; title?: string }>;
  /** The page the answer was on (provenance only; never fetched). */
  pageUrl?: string;
}

export interface ManualCaptureResult {
  runId: string;
  batchId: string;
  promptId: string;
  promptText: string;
  matched: "selected" | "exact" | "added";
  /** Tracked companies found in the answer, in order of first mention. */
  mentions: Array<{ name: string; sentiment: string; isTarget: boolean }>;
  citations: number;
}

/** The persist function is injected by the orchestrator, so this module adds no cycle. */
export type PersistFn = (args: {
  runId: string;
  brandId: string;
  batchId: string;
  promptId: string;
  promptText: string;
  engine: ManualEngine;
  runIdx: number;
  engineResult: {
    responseText: string;
    citations: Array<{ url: string; title: string }>;
    subQueries: string[];
    executionMs: number;
    captureMethod: "manual";
  };
  brandDomain: string;
  competitorDomains: string[];
  trackedEntities: CrawlEntity[];
}) => Promise<void>;

const day = () => nowIso().slice(0, 10);

export async function storeManualCapture(input: ManualCaptureInput, persist: PersistFn): Promise<ManualCaptureResult> {
  const sqlite = getRawDb();
  const brandRow = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(input.brandId);
  if (!brandRow) throw new CaptureRejectedError("That client does not exist", 404);
  const brand = rowToBrand(brandRow as Record<string, unknown>);
  if (!(MANUAL_ENGINES as readonly string[]).includes(input.engine)) throw new CaptureRejectedError(`Unknown engine "${input.engine}"`, 400);

  // Which tracked question this answers
  let prompt: { id: string; query_text: string } | undefined;
  let matched: ManualCaptureResult["matched"];
  if (input.promptId) {
    prompt = sqlite.prepare("SELECT id, query_text FROM prompts WHERE id = ? AND brand_id = ?").get(input.promptId, brand.id) as typeof prompt;
    if (!prompt) throw new CaptureRejectedError("That question is not tracked for this client (it may have been deleted)", 404);
    matched = "selected";
  } else {
    const q = normalizeQuestion(input.question || "");
    if (!q) throw new CaptureRejectedError("Choose the tracked question this answer belongs to", 400);
    const all = sqlite.prepare("SELECT id, query_text FROM prompts WHERE brand_id = ?").all(brand.id) as Array<{ id: string; query_text: string }>;
    prompt = all.find((p) => normalizeQuestion(p.query_text) === q);
    matched = "exact";
    if (!prompt) {
      if (!input.addAsPrompt) throw new CaptureRejectedError("This question is not tracked yet. Pick a tracked question or add it as a new one.", 409);
      const text = (input.question || "").trim().replace(/\s+/g, " ");
      if (text.length < 5 || text.length > 500) throw new CaptureRejectedError("A new question must be 5–500 characters", 400);
      const id = `prm-${crypto.randomBytes(6).toString("hex")}`;
      sqlite
        .prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active, created_at) VALUES (?, ?, ?, ?, 'buyer', 1, ?)")
        .run(id, brand.id, text, (input.intent || "category").trim().slice(0, 40) || "category", nowIso());
      prompt = { id, query_text: text };
      matched = "added";
    }
  }

  // Same checks as a crawled answer: an error or limit page is refused, not stored
  const answer = (input.answerText || "").trim();
  try {
    assertRealAnswer(answer, `manual-${input.engine}`, prompt.query_text);
  } catch (err) {
    throw new CaptureRejectedError(`This does not look like a finished answer: ${(err as Error).message}`, 422);
  }
  // A double click or a second save of the same page is not a second observation
  const duplicate = sqlite
    .prepare(
      "SELECT id FROM prompt_runs WHERE brand_id = ? AND prompt_id = ? AND engine = ? AND capture_method = 'manual' AND response_text = ? LIMIT 1"
    )
    .get(brand.id, prompt.id, input.engine, answer) as { id: string } | undefined;
  if (duplicate) throw new CaptureRejectedError("This exact answer is already saved for this question", 409);

  const seen = new Set<string>();
  const citations: Array<{ url: string; title: string }> = [];
  for (const c of input.citations || []) {
    if (typeof c?.url !== "string" || !/^https?:\/\//i.test(c.url)) continue;
    const url = cleanCitationUrl(c.url);
    if (seen.has(url)) continue;
    seen.add(url);
    citations.push({ url, title: (c.title || "").trim().slice(0, 300) || url });
    if (citations.length >= 100) break;
  }

  // The day's hand-capture batch for this client
  const batchId = `manual-${brand.id}-${day()}`;
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO crawl_batches (id, brand_id, status, sample_size, total_runs, completed_runs, current_prompt, current_engine, owner, created_at, finished_at)
       VALUES (?, ?, 'completed', 1, 0, 0, 'Answers captured by hand with the PrismGEO extension', 'manual', ?, ?, ?)`
    )
    .run(batchId, brand.id, MANUAL_BATCH_OWNER, nowIso(), nowIso());
  const runIdx = Number(
    (sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE batch_id = ? AND prompt_id = ? AND engine = ?").get(batchId, prompt.id, input.engine) as { n: number }).n
  );

  const { entities, competitorDomains } = trackedEntitiesFor(brand);
  const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await persist({
    runId,
    brandId: brand.id,
    batchId,
    promptId: prompt.id,
    promptText: prompt.query_text,
    engine: input.engine,
    runIdx,
    engineResult: { responseText: answer, citations, subQueries: [], executionMs: 0, captureMethod: "manual" },
    brandDomain: brand.domain,
    competitorDomains,
    trackedEntities: entities,
  });
  sqlite
    .prepare("UPDATE crawl_batches SET total_runs = total_runs + 1, completed_runs = completed_runs + 1, finished_at = ? WHERE id = ?")
    .run(nowIso(), batchId);

  const mentions = (
    sqlite.prepare("SELECT entity_name, sentiment, is_target_brand FROM entity_mentions WHERE run_id = ? ORDER BY position_rank IS NULL, position_rank").all(runId) as Array<{
      entity_name: string;
      sentiment: string;
      is_target_brand: number;
    }>
  ).map((m) => ({ name: m.entity_name, sentiment: m.sentiment, isTarget: m.is_target_brand === 1 }));
  return { runId, batchId, promptId: prompt.id, promptText: prompt.query_text, matched, mentions, citations: citations.length };
}
