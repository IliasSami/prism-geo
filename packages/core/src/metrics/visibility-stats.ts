import type { SentimentType, StanceType } from "../types/index";
import { findEntityHits, proseOf } from "../text/mentions";
import { stanceOf } from "../text/stance";

/**
 * The statistics behind the visibility numbers: Wilson intervals, prompt-clustered rates, and the
 * position prominence stored per mention. Everything here is a pure function of counts.
 */

/**
 * Two-sided Wilson score interval (95% by default) for `successes` out of `total`. Well behaved
 * for small n and for rates at 0 or 1. `successes` may be fractional (used with an effective n).
 */
export function wilsonInterval(successes: number, total: number, z = 1.96): [number, number] {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(successes) || successes < 0) return [0, 0];
  const k = Math.min(total, Math.max(0, successes));
  const p = k / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  const lower = k === 0 ? 0 : Math.max(0, center - spread);
  const upper = k === total ? 1 : Math.min(1, center + spread);
  return [Number(lower.toFixed(3)), Number(upper.toFixed(3))];
}

/** Hits and answers of one prompt (a cluster of correlated answers). */
export interface PromptCluster {
  hits: number;
  runs: number;
}

export interface ClusteredRate {
  /** Mean over prompts of each prompt's hit share (0..1). */
  p: number;
  /** Wilson 95% interval computed on the effective sample size (0..1). */
  low: number;
  high: number;
  /** Prompts with at least one answer (the clusters). */
  questions: number;
  /** Answers over all prompts. */
  answers: number;
  /** Answers that hit. */
  hits: number;
  /** Effective number of independent observations: answers / design effect, between questions and answers. */
  nEff: number;
  /** Estimated intra-prompt correlation (0..1). */
  icc: number;
}

/**
 * Intra-cluster correlation of a binary outcome, one-way ANOVA estimator, clamped to [0, 1].
 * When it cannot be estimated (fewer than 2 prompts, or no variance at all) it returns 1, the
 * conservative choice: repeated answers to one prompt then count as one observation.
 */
export function estimateIcc(clusters: PromptCluster[]): number {
  const cs = clusters.filter((c) => c.runs > 0);
  const k = cs.length;
  const n = cs.reduce((s, c) => s + c.runs, 0);
  if (k < 2 || n <= k) return 1;
  const pBar = cs.reduce((s, c) => s + c.hits, 0) / n;
  const msb = cs.reduce((s, c) => s + c.runs * (c.hits / c.runs - pBar) ** 2, 0) / (k - 1);
  const msw = cs.reduce((s, c) => s + c.hits * (1 - c.hits / c.runs), 0) / (n - k);
  const n0 = (n - cs.reduce((s, c) => s + c.runs * c.runs, 0) / n) / (k - 1);
  const denom = msb + (n0 - 1) * msw;
  if (denom <= 0) return 1;
  return Math.min(1, Math.max(0, (msb - msw) / denom));
}

/**
 * Prompt-clustered rate. Answers to the same prompt (repeats, several engines) are correlated, and
 * the population of interest is questions, so:
 *   p    = mean over prompts of hits_i / runs_i
 *   nEff = answers / (1 + (m - 1) * ICC), m = mean answers per prompt (bounded by [questions, answers])
 *   CI   = Wilson(p * nEff, nEff)
 * With one answer per prompt this is exactly the plain Wilson interval.
 */
export function clusteredRate(clusters: PromptCluster[]): ClusteredRate {
  const cs = clusters.filter((c) => c.runs > 0);
  const questions = cs.length;
  const answers = cs.reduce((s, c) => s + c.runs, 0);
  const hits = cs.reduce((s, c) => s + Math.min(c.hits, c.runs), 0);
  if (questions === 0) return { p: 0, low: 0, high: 0, questions: 0, answers: 0, hits: 0, nEff: 0, icc: 0 };
  const p = cs.reduce((s, c) => s + Math.min(c.hits, c.runs) / c.runs, 0) / questions;
  const m = answers / questions;
  const icc = m > 1 ? estimateIcc(cs) : 0;
  const nEff = Math.min(answers, Math.max(questions, answers / (1 + (m - 1) * icc)));
  const [low, high] = wilsonInterval(p * nEff, nEff);
  return { p, low, high, questions, answers, hits, nEff: Number(nEff.toFixed(2)), icc: Number(icc.toFixed(3)) };
}

/**
 * Position prominence in (0, 1]. With a list position it is the DCG discount 1 / log2(1 + pos)
 * (#1 = 1.0, #2 = 0.63, #3 = 0.5); otherwise exp(-1.189 * offset / length) on the prose text.
 * Stored per mention; not used in any headline rate.
 */
export function prominenceScore(charIndex: number, totalLength: number, listPosition?: number | null): number {
  if (listPosition && listPosition > 0) return Number((1 / Math.log2(1 + listPosition)).toFixed(3));
  if (!Number.isFinite(totalLength) || totalLength <= 0 || !Number.isFinite(charIndex) || charIndex < 0) return 0;
  return Number(Math.exp(-1.189 * Math.min(1, charIndex / totalLength)).toFixed(3));
}

/**
 * Stance of a text towards one name, using the shared stance engine (all occurrences, scoped,
 * negation-aware). Convenience wrapper for callers that have only a text and a name.
 */
export function classifyStance(text: string, entityName: string): { stance: StanceType; sentiment: SentimentType; hasCaveat: boolean } {
  const prose = proseOf(text || "");
  const hits = entityName ? findEntityHits(prose, [entityName]) : [];
  if (hits.length === 0) return { stance: "neutral", sentiment: "neutral", hasCaveat: false };
  return stanceOf(prose, hits, hits.map((h) => h.index));
}
