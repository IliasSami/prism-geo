import type { Hit } from "./mentions";
import type { SentimentType, StanceType } from "../types/index";

/**
 * Rule-based stance of an answer towards one entity.
 *
 * 1. Every word-bounded occurrence of the entity is read, not only the first.
 * 2. Each occurrence is read in a scope:
 *    - a table row is its own scope;
 *    - a short heading-like line ("Best for X: Dialsy AI", "Ringo Calls") is read with the next line;
 *    - a line that names no other tracked entity is its scope;
 *    - otherwise the sentence, split into comma / "but" / "while" clauses; a clause that names no
 *      entity belongs to the entity clause before it ("Unlike A, which can get expensive, B ...").
 * 3. Signals are word-bounded phrases; a negation within three words before a signal ("not
 *    expensive", "no major drawbacks", "not limited") cancels it.
 * 4. An explicit recommendation outranks a caveat: recommended + caveat is positive with
 *    hasCaveat = true; a caveat alone is negative; nothing is neutral.
 */

/** Primary recommendation phrases. */
const PRIMARY = /\b(best overall|top (pick|choice|recommendation)|my (top )?pick|number one|best (fit|option|choice|starting point|bet)|i'?d (recommend|pick|choose|go with)|we recommend|highly recommended|most recommended|recommend(ed)?|standout|highest[- ]rated|safest choice|go[- ]to (option|choice|tool))\b|#1\b/i;
/** Qualified recommendation phrases ("best for a use case", runner-up). */
const ALTERNATIVE = /\b(best for\b|(strong|solid|good|great|viable|excellent)(est)? (option|alternative|choice|pick|contender)|worth (considering|a look|trying)|also consider|(?:is )?another solid|runner[- ]up|try|inexpensive|affordable|easy to (set up|use|install)|no (major |real |significant )?(drawbacks|complaints|issues))\b/i;
/** Caveats and warnings. "inexpensive", "unlimited" and "complaint-free" do not match. */
const CAVEAT = /\b((?<!in)expensive|pricey|overpriced|drawbacks?|downsides?|steep learning curve|high latency|lacks?|lacking|limited|caution|complain(s|ts?|ed)?|poor(ly)?|not recommended|struggles?|thin|scam|red flags?|buggy|unreliable|clunky|outdated)\b/i;
/** A negation shortly before a signal cancels it. */
const NEGATION_BEFORE = /\b(no|not|never|without|hardly|isn'?t|aren'?t|doesn'?t|don'?t|wasn'?t|n't)\s+(\S+\s+){0,2}$/i;

export interface StanceResult {
  stance: StanceType;
  sentiment: SentimentType;
  /** A caveat or warning was attached to the entity, even if it was also recommended. */
  hasCaveat: boolean;
}

function lineBounds(text: string, at: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const nl = text.indexOf("\n", at);
  return { start, end: nl === -1 ? text.length : nl };
}

/** Text scopes describing the occurrence at `at`. `others` are start offsets of other entities. */
export function stanceScopes(text: string, at: number, length: number, others: number[]): string[] {
  const { start, end } = lineBounds(text, at);
  const line = text.slice(start, end);
  const trimmed = line.trim();
  if (trimmed.startsWith("|")) return [line];
  if (trimmed.length < 80 && !/[.!?:;]$/.test(trimmed.replace(/\*+$/, ""))) {
    // Heading-like line: the next non-empty line describes it
    let nextStart = end + 1;
    while (nextStart < text.length && text[nextStart] === "\n") nextStart++;
    const next = nextStart < text.length ? text.slice(nextStart, lineBounds(text, nextStart).end) : "";
    return next.trim().startsWith("|") ? [line] : [line, next];
  }
  if (!others.some((x) => x >= start && x < end)) return [line];

  // Sentence of the occurrence, then its clauses
  const rel = at - start;
  const boundary = /[.!?;](\s|$)/g;
  let sStart = 0;
  let sEnd = line.length;
  for (const m of line.matchAll(boundary)) {
    const idx = m.index ?? 0;
    if (idx < rel) sStart = idx + 1;
    else if (idx >= rel + length) {
      sEnd = idx + 1;
      break;
    }
  }
  const sentence = line.slice(sStart, sEnd);
  const offset = start + sStart;
  const clauses: Array<{ s: number; e: number; text: string }> = [];
  let pos = 0;
  for (const part of sentence.split(/(?<=,)\s+|\s+(?=(?:but|while|whereas|although|though)\b)/i)) {
    const s = sentence.indexOf(part, pos);
    clauses.push({ s: offset + s, e: offset + s + part.length, text: part });
    pos = s + part.length;
  }
  const own = Math.max(0, clauses.findIndex((c) => at >= c.s && at < c.e));
  const out = [clauses[own].text];
  for (let i = own + 1; i < clauses.length; i++) {
    if (others.some((x) => x >= clauses[i].s && x < clauses[i].e)) break;
    out.push(clauses[i].text);
  }
  return out;
}

/** True when `re` matches somewhere in `scope` without a negation just before it. */
export function hasSignal(scope: string, re: RegExp): boolean {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of scope.matchAll(global)) {
    if (!NEGATION_BEFORE.test(scope.slice(0, m.index))) return true;
  }
  return false;
}

/** A table cell that is a single short fact ("Limited", "Yes") is not a judgement of the vendor. */
function tableCellsWithJudgement(row: string): string {
  return row
    .split("|")
    .filter((cell) => cell.trim().split(/\s+/).filter(Boolean).length >= 3)
    .join(" | ");
}

/**
 * Stance of the answer towards an entity, given its hits in `prose` and the start offsets of
 * every tracked entity's hits (the entity's own included or not; they are filtered).
 */
export function stanceOf(prose: string, hits: Hit[], allEntityStarts: number[]): StanceResult {
  let primary = false;
  let alternative = false;
  let caveat = false;
  const own = new Set(hits.map((h) => h.index));
  const others = allEntityStarts.filter((x) => !own.has(x));
  for (const hit of hits) {
    for (const raw of stanceScopes(prose, hit.index, hit.length, others)) {
      const scope = raw.trim().startsWith("|") ? tableCellsWithJudgement(raw) : raw;
      if (hasSignal(scope, PRIMARY)) primary = true;
      else if (hasSignal(scope, ALTERNATIVE)) alternative = true;
      if (hasSignal(scope, CAVEAT)) caveat = true;
    }
  }
  if (primary) return { stance: "recommended_primary", sentiment: "positive", hasCaveat: caveat };
  if (alternative) return { stance: "recommended_alternative", sentiment: "positive", hasCaveat: caveat };
  if (caveat) return { stance: "warning_caution", sentiment: "negative", hasCaveat: true };
  return { stance: "neutral", sentiment: "neutral", hasCaveat: false };
}
