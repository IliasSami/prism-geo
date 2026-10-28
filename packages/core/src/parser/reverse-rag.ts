import type { ReverseRagAlignment, SourceCitationType } from "../types/index";
import { canonicalUrl, domainMatches, hostKey, isInternalHost } from "../url/canonical";
import { MARKDOWN_LINK, isGenericHost } from "../text/mentions";

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
  "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
  "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she",
  "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom",
  "why", "with", "would", "you", "your", "yours", "yourself", "yourselves"
]);

const VALID_TLDS = new Set([
  "com", "org", "net", "io", "ai", "agency", "app", "dev", "biz", "info",
  "travel", "tech", "cloud", "media", "expert", "consulting", "digital",
  "solutions", "uk", "de", "ca", "us", "me", "tv", "cc", "co", "co.uk", "org.uk", "com.au"
]);

const NOISE_DOMAINS = new Set([
  "bing.com", "microsoft.com", "google.com", "msn.com", "live.com", "yahoo.com",
  "duckduckgo.com", "baidu.com", "yandex.com",
  "whatsapp.com", "web.whatsapp.com", "instagram.com", "facebook.com", "youtube.com",
  "tiktok.com", "pinterest.com", "snapchat.com", "twitter.com", "x.com", "t.co",
  "vietnam.travel", "foodvietnamese.com", "wvstateparks.com",
  "dictionary.cambridge.org", "merriam-webster.com", "wiktionary.org",
  "support.microsoft.com", "support.google.com", "answers.microsoft.com"
]);

export function cleanExtractedHost(hostname: string): string {
  let host = (hostname || "").toLowerCase().trim().replace(/^www\./, "");
  if (!host) return "unknown";

  const parts = host.split(".");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (VALID_TLDS.has(last)) return host;
    if (parts.length >= 3 && VALID_TLDS.has(parts[parts.length - 2] + "." + parts[parts.length - 1])) {
      return host;
    }
    // If the last label is glued to trailing text (e.g. comwhite-label, comwhatsapp, ioBest)
    const sortedTlds = Array.from(VALID_TLDS)
      .filter((t) => !t.includes("."))
      .sort((a, b) => b.length - a.length);
    for (const tld of sortedTlds) {
      if (last === tld) return parts.join(".");
      if (last.startsWith(tld) && last.length > tld.length && /[A-Z0-9]/.test(last[tld.length])) {
        parts[parts.length - 1] = tld;
        return parts.join(".");
      }
    }
  }
  return host;
}

export interface ExtractedCitation {
  url: string;
  domain: string;
  anchorText: string;
  sourceType: SourceCitationType;
  isBrandDomain: boolean;
  isCompetitorDomain: boolean;
  /** 1-based order of first appearance in the text (markdown links and raw URLs together). */
  rank: number;
}

/** A passage counts as reused only with this much evidence. */
export const REUSE_MIN_SCORE = 0.35;
export const REUSE_MIN_SHINGLES = 2;

/** Lower-case word tokens (any script), stop words and very short tokens removed. */
function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [w, v] of b) {
    nb += v * v;
    const x = a.get(w);
    if (x) dot += x * v;
  }
  return na > 0 && nb > 0 ? Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))) : 0;
}

function shingles(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  return out;
}

const BOILERPLATE = /\b(cookies?|privacy policy|terms of (service|use)|all rights reserved|subscribe|newsletter|sign up|log in|sign in|book a demo|accept all|manage preferences)\b/i;

/**
 * Page paragraphs that cannot be evidence of reuse: cookie banners, sign-up and demo prompts,
 * navigation strings (no function words, or mostly repeated words) and fragments under 8 words.
 */
export function isBoilerplateParagraph(paragraph: string): boolean {
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (words.length < 8) return true;
  if (BOILERPLATE.test(paragraph) && words.length < 60) return true;
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (lower.length === 0) return true;
  const unique = new Set(lower).size / lower.length;
  const functionWords = lower.filter((w) => FUNCTION_WORDS.has(w)).length / lower.length;
  return unique < 0.5 || functionWords < 0.08;
}

/**
 * Matcher for a competitor's configured domain. A bare host matches the host and its subdomains;
 * a host with a path ("apps.shopify.com/hoop-voice") matches URLs under that path only; a bare
 * marketplace/review host ("apps.shopify.com", "g2.com") matches nothing, because a listing page
 * there is not the competitor's own site.
 */
export function competitorMatcher(configured: string): (url: string) => boolean {
  const raw = configured.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = hostKey(raw);
  const pathPart = raw.slice(raw.indexOf(host) + host.length).replace(/^:\d+/, "").split(/[?#]/)[0].replace(/\/+$/, "");
  if (!host) return () => false;
  if (pathPart && pathPart !== "/") {
    const prefix = `${host}${pathPart}`;
    return (url) => {
      try {
        const u = new URL(url);
        const here = `${hostKey(u.hostname)}${u.pathname.toLowerCase()}`;
        return here === prefix || here.startsWith(`${prefix}/`);
      } catch {
        return false;
      }
    };
  }
  if (isGenericHost(host)) return () => false;
  return (url) => {
    try {
      return domainMatches(new URL(url).hostname, host);
    } catch {
      return false;
    }
  };
}

const FUNCTION_WORDS = new Set([
  ...STOP_WORDS,
  // French, Spanish, German, Italian, Portuguese, Dutch function words, so non-English pages are not mistaken for navigation
  "le", "la", "les", "des", "de", "du", "un", "une", "et", "en", "par", "pour", "avec", "sur", "dans", "est", "que", "qui", "au", "aux", "ce", "il", "elle", "nous", "vous", "pas", "plus",
  "el", "los", "las", "del", "y", "con", "para", "por", "es", "una", "lo", "se", "su", "al", "como",
  "der", "die", "das", "und", "mit", "für", "von", "ist", "ein", "eine", "zu", "den", "dem", "im", "auf", "nicht", "sie", "es", "wir",
  "il", "di", "che", "per", "con", "gli", "della", "sono", "da", "nel",
  "o", "os", "e", "do", "da", "com", "não", "uma", "het", "een", "van", "voor", "op", "met", "niet",
]);

export class ReverseRagParser {
  /**
   * Canonical form of a cited URL (see url/canonical.ts) plus its comparison domain and any
   * scroll-to-text fragment. Returns an empty URL for anything that is not http(s).
   */
  public static normalizeUrl(rawUrl: string): { normalizedUrl: string; domain: string; textFragment?: string } {
    if (!rawUrl || typeof rawUrl !== "string") return { normalizedUrl: "", domain: "unknown" };
    let clean = rawUrl.trim();
    let textFragment: string | undefined;
    const frag = clean.indexOf("#:~:text=");
    if (frag !== -1) {
      try {
        textFragment = decodeURIComponent(clean.slice(frag + 9));
      } catch {
        textFragment = clean.slice(frag + 9);
      }
      clean = clean.slice(0, frag);
    }
    // Text glued after a TLD without a slash ("https://example.comWhite-Label")
    clean = clean.replace(
      /^(https?:\/\/[^/?#\s]*?\.(?:com|org|net|io|ai|agency|consulting|solutions|digital|expert|travel|cloud|media|tech|app|dev|biz|info|co|uk|de|ca|us|me))([A-Z][a-zA-Z0-9_\-/]*)$/,
      "$1"
    );
    const normalizedUrl = canonicalUrl(clean);
    if (!normalizedUrl) return { normalizedUrl: "", domain: "unknown" };
    const domain = cleanExtractedHost(hostKey(normalizedUrl));
    return { normalizedUrl, domain: domain || "unknown", textFragment };
  }

  /** Category of a cited domain. */
  public static classifySourceType(domain: string, isBrand: boolean, isCompetitor: boolean): SourceCitationType {
    if (isBrand) return "official_domain";
    if (isCompetitor) return "competitor_domain";
    const d = hostKey(domain);
    const on = (hosts: string[]) => hosts.some((h) => d === h || d.endsWith(`.${h}`));
    if (on(["g2.com", "capterra.com", "trustpilot.com", "producthunt.com", "softwareadvice.com", "getapp.com"])) return "software_review";
    if (on(["reddit.com", "quora.com", "ycombinator.com", "stackoverflow.com"])) return "community_forum";
    if (on(["forbes.com", "techcrunch.com", "venturebeat.com", "medium.com", "bloomberg.com", "wired.com", "wikipedia.org"])) return "editorial_press";
    return "unknown";
  }

  /**
   * Cited URLs in a text: markdown links (with balanced parentheses in the URL) and raw URLs,
   * ranked in document order, canonicalised and de-duplicated. Search-engine/social noise hosts
   * and internal or private-network hosts (localhost, 10.x, 169.254.x, ::1 ...) are never kept.
   */
  public static extractCitationsFromText(text: string, brandDomain: string, competitorDomains: string[]): ExtractedCitation[] {
    if (!text || typeof text !== "string") return [];
    // Unglue URLs concatenated to a capitalised title ("https://x.comWhite-Label")
    const source = text.replace(
      /(https?:\/\/[a-zA-Z0-9_\-.]+?\.(?:com|org|net|io|ai|agency|consulting|solutions|digital|expert|travel|cloud|media|tech|app|dev|biz|info|co|uk|de|ca|us|me))([A-Z][a-zA-Z0-9_-]*)/g,
      "$1 $2"
    );
    const found: Array<{ index: number; url: string; anchor: string | null }> = [];
    const covered: Array<[number, number]> = [];
    for (const m of source.matchAll(MARKDOWN_LINK)) {
      const index = m.index ?? 0;
      covered.push([index, index + m[0].length]);
      found.push({ index, url: m[2], anchor: m[1].trim() || null });
    }
    for (const m of source.matchAll(/https?:\/\/[^\s<>"'\]]+/gi)) {
      const index = m.index ?? 0;
      if (covered.some(([s, e]) => index >= s && index < e)) continue;
      found.push({ index, url: m[0], anchor: null });
    }
    found.sort((a, b) => a.index - b.index);

    const brand = hostKey(brandDomain || "");
    const competitors = (Array.isArray(competitorDomains) ? competitorDomains : [])
      .filter((c) => typeof c === "string" && c.trim())
      .map(competitorMatcher);
    const seen = new Set<string>();
    const out: ExtractedCitation[] = [];
    for (const f of found) {
      const { normalizedUrl, domain } = this.normalizeUrl(f.url);
      if (!normalizedUrl || domain === "unknown" || seen.has(normalizedUrl)) continue;
      let host: string;
      try {
        host = new URL(normalizedUrl).hostname;
      } catch {
        continue;
      }
      if (isInternalHost(host)) continue;
      const isBrandDomain = brand !== "" && domainMatches(domain, brand);
      const isCompetitorDomain = competitors.some((match) => match(normalizedUrl));
      if (!isBrandDomain && !isCompetitorDomain) {
        if ([...NOISE_DOMAINS].some((noise) => domain === noise || domain.endsWith(`.${noise}`))) continue;
        if (!domain.includes(".") || domain.length < 4) continue;
      }
      seen.add(normalizedUrl);
      out.push({
        url: normalizedUrl,
        domain,
        anchorText: f.anchor || domain,
        sourceType: this.classifySourceType(domain, isBrandDomain, isCompetitorDomain),
        isBrandDomain,
        isCompetitorDomain,
        rank: out.length + 1,
      });
    }
    return out;
  }

  /**
   * Finds the page paragraph an answer most likely reused. Scoring is term-frequency cosine (no
   * IDF) between each page paragraph and each answer sentence (and the whole answer), after
   * dropping boilerplate paragraphs; the evidence also counts shared content 3-gram shingles.
   * `isReuse` is true only when the best score is >= REUSE_MIN_SCORE and the paragraph shares at
   * least REUSE_MIN_SHINGLES shingles with the answer. Callers store a passage only when isReuse.
   */
  public static computeChunkAlignment(answerSnippet: string, sourcePageText: string, url: string): ReverseRagAlignment {
    const { domain } = this.normalizeUrl(url);
    const empty = (reason: string): ReverseRagAlignment => ({
      url,
      domain: domain || "unknown",
      sourceType: ReverseRagParser.classifySourceType(domain, false, false),
      extractedSnippet: (answerSnippet || "").slice(0, 300),
      sourceChunkText: "",
      alignmentScore: 0,
      sharedShingles: 0,
      isReuse: false,
      answerSentence: "",
      isSelfContained: false,
      wordCount: 0,
      attributionGap: reason,
    });
    if (!answerSnippet || typeof answerSnippet !== "string" || !sourcePageText || typeof sourcePageText !== "string") {
      return empty("Invalid or empty content for comparison.");
    }

    let paragraphs = sourcePageText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length <= 1) paragraphs = sourcePageText.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    paragraphs = paragraphs.filter((p) => !isBoilerplateParagraph(p));
    if (paragraphs.length === 0) return empty("No substantive paragraphs on the cited page (only navigation, banners or fragments).");

    const answerTokens = contentTokens(answerSnippet);
    if (answerTokens.length === 0) return empty("Empty content tokens for comparison.");
    const answerShingles = shingles(answerTokens);
    const units = [
      { text: answerSnippet, tf: termFrequencies(answerTokens) },
      ...answerSnippet
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .map((s) => ({ text: s, tokens: contentTokens(s) }))
        .filter((s) => s.tokens.length >= 6)
        .map((s) => ({ text: s.text, tf: termFrequencies(s.tokens) })),
    ];

    let best = { score: 0, para: "", sentence: "", shingles: 0 };
    for (const para of paragraphs) {
      const tokens = contentTokens(para);
      if (tokens.length === 0) continue;
      const tf = termFrequencies(tokens);
      let score = 0;
      let sentence = "";
      for (const u of units) {
        const s = cosine(u.tf, tf);
        if (s > score) {
          score = s;
          sentence = u.text;
        }
      }
      if (score > best.score) {
        let shared = 0;
        for (const sh of shingles(tokens)) if (answerShingles.has(sh)) shared++;
        best = { score, para, sentence, shingles: shared };
      }
    }

    const wordCount = best.para.split(/\s+/).filter(Boolean).length;
    const isSelfContained = wordCount >= 100 && wordCount <= 220;
    const isReuse = best.score >= REUSE_MIN_SCORE && best.shingles >= REUSE_MIN_SHINGLES;
    const attributionGap = !isReuse
      ? "No evidence of reuse: the closest paragraph shares too few words or phrases with the answer."
      : !isSelfContained
        ? "Reused passage is outside the 100-220 word self-contained answer-block range."
        : null;
    return {
      url,
      domain,
      sourceType: ReverseRagParser.classifySourceType(domain, false, false),
      extractedSnippet: answerSnippet.slice(0, 300),
      sourceChunkText: best.para.slice(0, 500),
      alignmentScore: Number(best.score.toFixed(3)),
      sharedShingles: best.shingles,
      isReuse,
      answerSentence: best.sentence.slice(0, 500),
      isSelfContained,
      wordCount,
      attributionGap,
    };
  }
}
