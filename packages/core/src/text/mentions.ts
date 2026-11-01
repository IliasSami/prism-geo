import { COMMON_WORDS } from "./common-words";
import { hostKey } from "../url/canonical";

/**
 * Mention detection shared by the crawler (persistRun) and the report. There is exactly one
 * implementation of each step here; nothing else should re-derive entity terms or echoes.
 *
 *   proseOf(text)          the answer as a reader sees it: no URLs, no source-chip link labels
 *   entityTerms(...)       the surface forms an entity is recognised by
 *   termRegex(term)        whole-word, dash/space tolerant, URL-safe matcher for one term
 *   findEntityHits(...)    every occurrence of an entity in a prose text
 *   namesEntity(text, t)   does a short text (a prompt) name the entity
 *   dropNestedHits(...)    drops hits inside another entity's longer name ("Acme" in "Big Acme")
 *   detectMentions(...)    ranked, echo-aware mentions of tracked entities in one answer
 */

/** Hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar, minus sign. */
const DASHES = /[‐-―−]/g;
/** No-break, figure and narrow no-break spaces. */
const ODD_SPACES = /[   ]/g;
const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const CHIP_COUNT = /\+\s?\d+$/;
/** Markdown link with a URL that may contain balanced parentheses (Wikipedia-style). */
export const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gi;
const RAW_URL = /https?:\/\/[^\s<>"'\]]+/gi;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A link label that is a source chip ("talkly.com", "reddit +1") rather than prose. */
export function isSourceChipLabel(label: string): boolean {
  const l = label.trim();
  return l === "" || HOST_LIKE.test(l) || CHIP_COUNT.test(l);
}

/**
 * Prose-only view of an answer: markdown links keep their label unless it is a source chip,
 * raw URLs are removed (they are citations, not mentions), and dash/space variants are unified.
 * Line structure is preserved, so list and stance scoping still work on the result.
 */
export function proseOf(text: string): string {
  if (!text) return "";
  return text
    .replace(MARKDOWN_LINK, (_m, label: string) => (isSourceChipLabel(label) ? "" : label))
    .replace(RAW_URL, " ")
    .replace(/\(\s*\)/g, "")
    .replace(DASHES, "-")
    .replace(ODD_SPACES, " ")
    .replace(/[ \t]+(\n|$)/g, "$1");
}

/**
 * Marketplace, review and social hosts. A competitor "domain" on one of these (a Shopify App
 * Store listing, a G2 page) says nothing about its name, so neither the host nor its first label
 * becomes a mention term.
 */
const GENERIC_HOSTS = new Set([
  "apps.shopify.com", "shopify.com", "apps.apple.com", "play.google.com", "chrome.google.com", "chromewebstore.google.com",
  "workspace.google.com", "sites.google.com", "marketplace.zoom.us", "appexchange.salesforce.com", "ecosystem.hubspot.com",
  "marketplace.atlassian.com", "g2.com", "capterra.com", "getapp.com", "softwareadvice.com", "trustpilot.com", "producthunt.com",
  "linkedin.com", "github.com", "gitlab.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "tiktok.com",
  "reddit.com", "medium.com", "substack.com", "crunchbase.com", "wikipedia.org", "en.wikipedia.org", "zapier.com", "notion.site",
  "wordpress.com", "wix.com", "linktr.ee", "bit.ly",
]);

/** True for a marketplace/review/social host whose name is not the entity's name. */
export function isGenericHost(host: string): boolean {
  const h = hostKey(host);
  return GENERIC_HOSTS.has(h);
}

/** Generic suffixes dropped from a name ("Vocora AI" -> "Vocora", "Callexa.io" -> "Callexa"). */
const NAME_SUFFIX = /(\.(ai|io|com|co|app)|\s+(ai|app|inc|hq|io|llc|ltd))$/i;

/** A word that is safe as a standalone term: long enough and not an ordinary English word. */
const distinctive = (word: string, min: number) => word.length >= min && !COMMON_WORDS.has(word.toLowerCase());

/**
 * All surface forms an entity can appear as: its name, its aliases, its domain, the name
 * without a generic suffix, and the domain's first label. Derived forms are only added when they
 * are distinctive (the stem at least 5 characters, neither an ordinary word), and marketplace or
 * review hosts never contribute terms.
 */
export function entityTerms(name: string, aliases: string[] | null | undefined, domain: string | null | undefined): string[] {
  const terms = new Set<string>();
  const add = (t: string | undefined, min = 4) => {
    const v = (t || "").replace(DASHES, "-").replace(ODD_SPACES, " ").replace(/\s+/g, " ").trim();
    if (v.length >= min) terms.add(v);
  };
  add(name, 3);
  for (const a of aliases || []) if (typeof a === "string") add(a);
  const stripped = (name || "").trim().replace(NAME_SUFFIX, "").trim();
  if (stripped && stripped !== name.trim() && (/\s/.test(stripped) || distinctive(stripped, 4))) add(stripped);
  const host = hostKey(domain || "");
  if (host && host.includes(".") && !isGenericHost(host)) {
    add(host);
    const stem = host.split(".")[0];
    if (/^[a-z0-9-]+$/.test(stem) && distinctive(stem, 5)) add(stem);
  }
  return [...terms];
}

/**
 * Removes accents letter by letter ("Équipe Délice" -> "Equipe Delice"), keeping the string's
 * length and every position unchanged, so hit offsets still point into the original text. A
 * character that does not fold to exactly one character is kept as it is.
 */
export function foldAccents(text: string): string {
  let out = "";
  for (const ch of text) {
    const folded = ch.normalize("NFD").replace(/\p{M}+/gu, "");
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

/** Words that can follow a name after a hyphen without making it a different name or a slug ("Acme-powered"). */
const HYPHEN_MODIFIERS =
  "powered|based|backed|built|driven|enabled|native|first|style|like|owned|made|led|integrated|compatible|friendly|certified|approved|hosted|specific|only|branded|focused|centric|ready|supported|exclusive";

/**
 * Whole-word matcher for one term. Dashes in the term match any dash with optional spaces
 * ("Hoop – AI" = "Hoop - AI" = "Hoop—AI"), whitespace matches any whitespace, and a match never
 * starts inside a URL/domain/path segment or ends where a domain or path continues ("vocora.ai/blog",
 * "northwind-voice" path parts and "northwindvoiceai.com" do not match "Northwind Voice").
 * A hyphen after the name only counts as a boundary before a modifier ("Acme-powered", not
 * "voice-over"); a slash only before a plain word ("Acme/Shopify", not "acme/blog/post"); "@Acme" matches.
 */
export function termRegex(term: string, flags = "gi"): RegExp {
  // Callers match against foldAccents(text): buyers often type brand names without accents
  const clean = foldAccents(term).replace(DASHES, "-").replace(ODD_SPACES, " ").trim();
  const body = escapeRegex(clean)
    .replace(/\s*-\s*/g, "\\s*-\\s*")
    .replace(/\s+/g, "\\s+");
  // A domain term ("acme.com") keeps the strict rules: "sales@acme.com" and "acme.com/blog" are not prose
  if (clean.includes(".")) return new RegExp(`(?<![\\w./@-])${body}(?![\\w/-]|\\.[a-z0-9])`, flags);
  const hyphen = `-(?!(?:${HYPHEN_MODIFIERS})\\b(?![-./]\\w))`;
  const path = `\\/(?=[^\\s/]*[/.][a-z0-9])`;
  return new RegExp(`(?<![\\w./-])${body}(?!\\w|\\.[a-z0-9]|${hyphen}|${path})`, flags);
}

/**
 * Terms matched with their exact case: ordinary words and very short names ("Front", "Close",
 * "Ada") would otherwise match everyday prose ("in front of", "a close call").
 */
export function isCaseSensitiveTerm(term: string): boolean {
  const t = term.trim();
  return t.length <= 4 || COMMON_WORDS.has(t.toLowerCase());
}

/** The matcher findEntityHits and namesEntity use for one term (case-sensitive for ambiguous terms). */
const entityTermRegex = (term: string, global: boolean) => termRegex(term, `${global ? "g" : ""}${isCaseSensitiveTerm(term) ? "" : "i"}`);

export interface Hit {
  index: number;
  length: number;
}

/** Every occurrence of any of the terms in a (prose) text, merged and sorted by position. */
export function findEntityHits(prose: string, terms: string[]): Hit[] {
  const hits: Hit[] = [];
  const folded = foldAccents(prose);
  for (const term of terms) {
    for (const m of folded.matchAll(entityTermRegex(term, true))) {
      const index = m.index ?? 0;
      // Keep the longest match at a position, drop matches nested in an earlier, longer one
      const overlap = hits.find((h) => index >= h.index && index < h.index + h.length);
      if (overlap) {
        if (index === overlap.index && m[0].length > overlap.length) overlap.length = m[0].length;
        continue;
      }
      hits.push({ index, length: m[0].length });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** True when a short text (a prompt) names the entity. */
export function namesEntity(text: string, terms: string[]): boolean {
  const prose = foldAccents(proseOf(text));
  return terms.some((t) => entityTermRegex(t, false).test(prose));
}

/**
 * Drops, from each entity's hits, those strictly inside a longer hit of another entity: in
 * "Big Acme", the tracked "Acme" is part of another tracked name, not a mention of its own.
 */
export function dropNestedHits(hitLists: Hit[][]): Hit[][] {
  return hitLists.map((hits, i) =>
    hits.filter(
      (h) =>
        !hitLists.some(
          (other, j) => j !== i && other.some((g) => g.length > h.length && g.index <= h.index && g.index + g.length >= h.index + h.length)
        )
    )
  );
}

/** Which of the entities a short text (a prompt) names, with names nested in another entity's name dropped. */
export function entitiesNamedIn(text: string, entities: Array<{ terms: string[] }>): boolean[] {
  const prose = proseOf(text);
  return dropNestedHits(entities.map((e) => findEntityHits(prose, e.terms))).map((hits) => hits.length > 0);
}

export interface TrackedEntity {
  /** Stable key (competitor id, or "brand" for the target). */
  key: string;
  name: string;
  isTarget: boolean;
  terms: string[];
}

export interface DetectedMention<E extends TrackedEntity = TrackedEntity> {
  entity: E;
  hits: Hit[];
  /** The prompt itself names this entity ("X alternatives", "is X legit"): an echo, not earned. */
  isPromptSubject: boolean;
  /** 1-based order of first mention among non-echo tracked entities; null for echoes. */
  positionRank: number | null;
  /** 1-based index of the first list item / table row naming the entity, when the answer is a list. */
  listPosition: number | null;
}

/**
 * Ranked mentions of tracked entities in one answer. Detection runs on proseOf(answer); echoes of
 * the prompt keep their mention (for branded-prompt presence) but get no rank.
 */
export function detectMentions<E extends TrackedEntity>(answer: string, entities: E[], promptText: string): { prose: string; mentions: DetectedMention<E>[] } {
  const prose = proseOf(answer);
  const items = listItems(prose);
  const hitLists = dropNestedHits(entities.map((entity) => findEntityHits(prose, entity.terms)));
  const echoes = entitiesNamedIn(promptText, entities);
  const found = entities
    .map((entity, i) => ({ entity, hits: hitLists[i], isPromptSubject: echoes[i] }))
    .filter((m) => m.hits.length > 0)
    .sort((a, b) => a.hits[0].index - b.hits[0].index);
  let rank = 0;
  const mentions = found.map((m) => ({
    ...m,
    positionRank: m.isPromptSubject ? null : ++rank,
    listPosition: listPositionOf(items, m.hits),
  }));
  return { prose, mentions };
}

// ---------------------------------------------------------------- list / table structure

export interface ListItem {
  start: number;
  end: number;
}

const LIST_LINE = /^\s*(\d{1,2}[.)]\s+|[-*•·]\s+)/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Items of the answer's list or table: numbered/bulleted lines and table body
 * rows (the header row above a separator is skipped). Returns [] unless there are at least two.
 */
export function listItems(prose: string): ListItem[] {
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let pos = 0;
  for (const text of prose.split("\n")) {
    lines.push({ start: pos, end: pos + text.length, text });
    pos += text.length + 1;
  }
  const items: ListItem[] = [];
  lines.forEach((l, i) => {
    if (TABLE_SEPARATOR.test(l.text) && l.text.includes("-")) return;
    if (TABLE_LINE.test(l.text)) {
      const next = lines[i + 1];
      if (next && TABLE_SEPARATOR.test(next.text)) return; // header row
      items.push({ start: l.start, end: l.end });
    } else if (LIST_LINE.test(l.text)) {
      items.push({ start: l.start, end: l.end });
    }
  });
  return items.length >= 2 ? items : [];
}

/** 1-based index of the first list item containing one of the hits, or null. */
export function listPositionOf(items: ListItem[], hits: Hit[]): number | null {
  for (let i = 0; i < items.length; i++) if (hits.some((h) => h.index >= items[i].start && h.index < items[i].end)) return i + 1;
  return null;
}
