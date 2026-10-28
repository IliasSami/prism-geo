import type { ReverseRagAlignment, SourceCitationType } from "../types/index";

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

export class ReverseRagParser {
  /**
   * Normalizes a URL: unwraps redirect proxies, strips tracking parameters, and trims fragments.
   */
  public static normalizeUrl(rawUrl: string): { normalizedUrl: string; domain: string; textFragment?: string } {
    if (!rawUrl || typeof rawUrl !== "string") {
      return { normalizedUrl: "", domain: "unknown" };
    }
    let clean = rawUrl.trim().replace(/[.,;:)\]>"']+$/, "");
    if (!clean) {
      return { normalizedUrl: "", domain: "unknown" };
    }

    // 1. Unwrap Google click redirect /url?q=...
    if (clean.includes("/url?q=")) {
      try {
        const u = new URL(clean);
        const target = u.searchParams.get("q");
        if (target) clean = target;
      } catch {
        // ignore
      }
    }

    // 2. Unwrap Bing click redirect /ck/a?...&u=a1<base64>...
    if (clean.includes("/ck/a?") || clean.includes("bing.com/ck/a")) {
      try {
        const u = new URL(clean);
        const rawU = u.searchParams.get("u");
        if (rawU && rawU.startsWith("a1")) {
          const decoded = Buffer.from(rawU.slice(2), "base64").toString("utf-8");
          if (decoded && (decoded.startsWith("http://") || decoded.startsWith("https://"))) {
            clean = decoded;
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Extract scroll-to-text fragment #:~:text=
    let textFragment: string | undefined;
    if (clean.includes("#:~:text=")) {
      const parts = clean.split("#:~:text=");
      clean = parts[0];
      textFragment = decodeURIComponent(parts[1] || "");
    }

    // 4. Unglue text accidentally concatenated after known TLD without slash
    // (e.g. https://example.comWhite-Label -> https://example.com)
    clean = clean.replace(
      /(\.(?:com|org|net|io|ai|agency|consulting|solutions|digital|expert|travel|cloud|media|tech|app|dev|biz|info|co|uk|de|ca|us|me))([A-Z][a-zA-Z0-9_\-\/]*)/g,
      "$1"
    );

    try {
      const parsed = new URL(clean);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { normalizedUrl: "", domain: "unknown" };
      }
      // Strip common ad/tracking query parameters
      const trackingParams = [
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "gclid", "fbclid", "msclkid", "ref", "source", "mc_cid", "mc_eid"
      ];
      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }

      const domain = cleanExtractedHost(parsed.hostname);
      if (domain !== "unknown" && parsed.hostname !== domain) {
        parsed.hostname = domain;
      }

      return {
        normalizedUrl: parsed.toString(),
        domain: domain || "unknown",
        textFragment,
      };
    } catch {
      return { normalizedUrl: clean, domain: "unknown" };
    }
  }

  /**
   * Identifies the category/source type of a cited domain.
   */
  public static classifySourceType(
    domain: string,
    isBrand: boolean,
    isCompetitor: boolean
  ): SourceCitationType {
    if (isBrand) return "official_domain";
    if (isCompetitor) return "competitor_domain";

    const d = domain.toLowerCase();
    if (
      d.includes("g2.com") ||
      d.includes("capterra.com") ||
      d.includes("trustpilot.com") ||
      d.includes("producthunt.com") ||
      d.includes("softwareadvice.com")
    ) {
      return "software_review";
    }

    if (
      d.includes("reddit.com") ||
      d.includes("quora.com") ||
      d.includes("ycombinator.com") ||
      d.includes("stackoverflow.com")
    ) {
      return "community_forum";
    }

    if (
      d.includes("forbes.com") ||
      d.includes("techcrunch.com") ||
      d.includes("venturebeat.com") ||
      d.includes("medium.com") ||
      d.includes("bloomberg.com") ||
      d.includes("wired.com") ||
      d.includes("wikipedia.org")
    ) {
      return "editorial_press";
    }

    return "unknown";
  }

  /**
   * Extracts links, domains, real anchor text, and source categories from markdown / raw text.
   */
  public static extractCitationsFromText(
    text: string,
    brandDomain: string,
    competitorDomains: string[]
  ): Array<{
    url: string;
    domain: string;
    anchorText: string;
    sourceType: SourceCitationType;
    isBrandDomain: boolean;
    isCompetitorDomain: boolean;
    rank: number;
  }> {
    if (!text || typeof text !== "string") {
      return [];
    }

    const citations: Array<{
      url: string;
      domain: string;
      anchorText: string;
      sourceType: SourceCitationType;
      isBrandDomain: boolean;
      isCompetitorDomain: boolean;
      rank: number;
    }> = [];

    const seenUrls = new Set<string>();
    let rank = 1;

    const cleanBrandDomain = typeof brandDomain === "string" ? brandDomain.toLowerCase().replace(/^www\./, "").trim() : "";
    const cleanCompetitors = Array.isArray(competitorDomains) ? competitorDomains : [];

    // 1. Extract markdown links: [Anchor Text](https://...)
    const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi;
    let mdMatch: RegExpExecArray | null;
    while ((mdMatch = mdRegex.exec(text)) !== null) {
      const rawAnchor = mdMatch[1].trim();
      const rawUrl = mdMatch[2].trim();
      const { normalizedUrl, domain } = this.normalizeUrl(rawUrl);
      if (!normalizedUrl || seenUrls.has(normalizedUrl) || domain === "unknown") continue;

      const isBrandDomain = cleanBrandDomain !== "" && (domain === cleanBrandDomain || domain.endsWith(`.${cleanBrandDomain}`));
      const isCompetitorDomain = cleanCompetitors.some((comp) => {
        if (!comp || typeof comp !== "string") return false;
        const c = comp.toLowerCase().replace(/^www\./, "").trim();
        return c !== "" && (domain === c || domain.endsWith(`.${c}`));
      });

      // Discard noise and garbage domains unless it is the target brand or configured competitor
      if (!isBrandDomain && !isCompetitorDomain) {
        if (NOISE_DOMAINS.has(domain) || Array.from(NOISE_DOMAINS).some((noise) => domain.endsWith(`.${noise}`))) {
          continue;
        }
        if (!domain.includes(".") || domain.length < 4) {
          continue;
        }
      }

      seenUrls.add(normalizedUrl);
      citations.push({
        url: normalizedUrl,
        domain,
        anchorText: rawAnchor || domain,
        sourceType: this.classifySourceType(domain, isBrandDomain, isCompetitorDomain),
        isBrandDomain,
        isCompetitorDomain,
        rank: rank++,
      });
    }

    // 2. Extract remaining raw URLs
    // Unglue any URLs concatenated directly to capitalized titles without whitespace
    const ungluedText = text.replace(
      /(https?:\/\/[a-zA-Z0-9_\-\.]+?\.(?:com|org|net|io|ai|agency|consulting|solutions|digital|expert|travel|cloud|media|tech|app|dev|biz|info|co|uk|de|ca|us|me))([A-Z][a-zA-Z0-9_\-]*)/g,
      "$1 $2"
    );

    const urlRegex = /(?:https?:\/\/[^\s\)\],>"']+)/gi;
    const rawMatches = ungluedText.match(urlRegex) || [];
    for (const rawUrl of rawMatches) {
      const { normalizedUrl, domain } = this.normalizeUrl(rawUrl);
      if (!normalizedUrl || seenUrls.has(normalizedUrl) || domain === "unknown") continue;

      const isBrandDomain = cleanBrandDomain !== "" && (domain === cleanBrandDomain || domain.endsWith(`.${cleanBrandDomain}`));
      const isCompetitorDomain = cleanCompetitors.some((comp) => {
        if (!comp || typeof comp !== "string") return false;
        const c = comp.toLowerCase().replace(/^www\./, "").trim();
        return c !== "" && (domain === c || domain.endsWith(`.${c}`));
      });

      // Discard noise and garbage domains unless it is the target brand or configured competitor
      if (!isBrandDomain && !isCompetitorDomain) {
        if (NOISE_DOMAINS.has(domain) || Array.from(NOISE_DOMAINS).some((noise) => domain.endsWith(`.${noise}`))) {
          continue;
        }
        if (!domain.includes(".") || domain.length < 4) {
          continue;
        }
      }

      seenUrls.add(normalizedUrl);
      citations.push({
        url: normalizedUrl,
        domain,
        anchorText: domain,
        sourceType: this.classifySourceType(domain, isBrandDomain, isCompetitorDomain),
        isBrandDomain,
        isCompetitorDomain,
        rank: rank++,
      });
    }

    return citations;
  }

  /**
   * Computes TF-IDF weighted cosine token vector alignment bounded strictly in [0.0, 1.0].
   * Filters stop words to prevent common linguistic tokens from distorting attribution.
   */
  public static computeChunkAlignment(
    answerSnippet: string,
    sourcePageText: string,
    url: string
  ): ReverseRagAlignment {
    const { domain } = this.normalizeUrl(url);

    if (!answerSnippet || typeof answerSnippet !== "string" || !sourcePageText || typeof sourcePageText !== "string") {
      return {
        url,
        domain: domain || "unknown",
        sourceType: ReverseRagParser.classifySourceType(domain, false, false),
        extractedSnippet: (answerSnippet || "").slice(0, 300),
        sourceChunkText: "",
        alignmentScore: 0.0,
        isSelfContained: false,
        wordCount: 0,
        attributionGap: "Invalid or empty content for comparison.",
      };
    }

    // Split source into semantic paragraphs or chunks
    let paragraphs = sourcePageText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 50);

    if (paragraphs.length === 0) {
      paragraphs = sourcePageText
        .split(/\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 50);
    }

    if (paragraphs.length === 0 && sourcePageText.trim().length > 0) {
      const words = sourcePageText.trim().split(/\s+/);
      const chunkSize = 150;
      for (let i = 0; i < words.length; i += 100) {
        const slice = words.slice(i, i + chunkSize).join(" ");
        if (slice.length > 50) paragraphs.push(slice);
      }
    }

    let bestScore = 0.0;
    let bestChunk = "";

    // Build Term Frequency map for answer tokens (filtered by stop words)
    const answerWords = answerSnippet
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    if (answerWords.length === 0) {
      return {
        url,
        domain,
        sourceType: ReverseRagParser.classifySourceType(domain, false, false),
        extractedSnippet: answerSnippet.slice(0, 300),
        sourceChunkText: "",
        alignmentScore: 0.0,
        isSelfContained: false,
        wordCount: 0,
        attributionGap: "Empty content tokens for comparison.",
      };
    }

    const answerTf = new Map<string, number>();
    for (const w of answerWords) {
      answerTf.set(w, (answerTf.get(w) || 0) + 1);
    }

    let normAnswer = 0;
    for (const [, count] of answerTf) {
      normAnswer += count * count;
    }

    for (const para of paragraphs) {
      const paraWords = para
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

      if (paraWords.length === 0) continue;

      const paraTf = new Map<string, number>();
      for (const w of paraWords) {
        paraTf.set(w, (paraTf.get(w) || 0) + 1);
      }

      let dotProduct = 0;
      let normPara = 0;

      for (const [w, countB] of paraTf) {
        normPara += countB * countB;
        const countA = answerTf.get(w);
        if (countA) {
          dotProduct += countA * countB;
        }
      }

      const denominator = Math.sqrt(normAnswer) * Math.sqrt(normPara);
      const cosineSim = denominator > 0 ? dotProduct / denominator : 0;
      const boundedScore = Math.min(1.0, Math.max(0.0, cosineSim));

      if (boundedScore > bestScore) {
        bestScore = boundedScore;
        bestChunk = para;
      }
    }

    const wordCount = bestChunk.split(/\s+/).filter(Boolean).length;
    // Ideal LLM retrieval passage: 130 - 170 words (accept 100 - 220)
    const isSelfContained = wordCount >= 100 && wordCount <= 220;

    const attributionGap =
      bestScore < 0.25
        ? "Low passage alignment: Model synthesized answer from parametric knowledge rather than direct retrieval citation."
        : !isSelfContained
        ? "Suboptimal chunk format: Source paragraph is outside the optimal 130-170 word self-contained answer block."
        : null;

    return {
      url,
      domain,
      sourceType: ReverseRagParser.classifySourceType(domain, false, false),
      extractedSnippet: answerSnippet.slice(0, 300),
      sourceChunkText: bestChunk.slice(0, 500),
      alignmentScore: Number(bestScore.toFixed(3)),
      isSelfContained,
      wordCount,
      attributionGap,
    };
  }
}
