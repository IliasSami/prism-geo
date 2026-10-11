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

export class ReverseRagParser {
  /**
   * Normalizes a URL: unwraps redirect proxies, strips tracking parameters, and trims fragments.
   */
  public static normalizeUrl(rawUrl: string): { normalizedUrl: string; domain: string; textFragment?: string } {
    let clean = rawUrl.trim().replace(/[.,;:)\]>]+$/, "");

    // Unwrap Google click redirect /url?q=...
    if (clean.includes("/url?q=")) {
      try {
        const u = new URL(clean);
        const target = u.searchParams.get("q");
        if (target) clean = target;
      } catch {
        // ignore
      }
    }

    // Extract scroll-to-text fragment #:~:text=
    let textFragment: string | undefined;
    if (clean.includes("#:~:text=")) {
      const parts = clean.split("#:~:text=");
      clean = parts[0];
      textFragment = decodeURIComponent(parts[1] || "");
    }

    try {
      const parsed = new URL(clean);
      // Strip common ad/tracking query parameters
      const trackingParams = [
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "gclid", "fbclid", "msclkid", "ref", "source", "mc_cid", "mc_eid"
      ];
      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }
      const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return {
        normalizedUrl: parsed.toString(),
        domain,
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

    // 1. Extract markdown links: [Anchor Text](https://...)
    const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi;
    let mdMatch: RegExpExecArray | null;
    while ((mdMatch = mdRegex.exec(text)) !== null) {
      const rawAnchor = mdMatch[1].trim();
      const rawUrl = mdMatch[2].trim();
      const { normalizedUrl, domain } = this.normalizeUrl(rawUrl);
      if (seenUrls.has(normalizedUrl) || domain === "unknown") continue;
      seenUrls.add(normalizedUrl);

      const targetClean = brandDomain.toLowerCase().replace(/^www\./, "");
      const isBrandDomain = domain === targetClean || domain.endsWith(`.${targetClean}`);
      const isCompetitorDomain = competitorDomains.some((comp) => {
        const c = comp.toLowerCase().replace(/^www\./, "");
        return domain === c || domain.endsWith(`.${c}`);
      });

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
    const urlRegex = /(?:https?:\/\/[^\s\)\],]+)/gi;
    const rawMatches = text.match(urlRegex) || [];
    for (const rawUrl of rawMatches) {
      const { normalizedUrl, domain } = this.normalizeUrl(rawUrl);
      if (seenUrls.has(normalizedUrl) || domain === "unknown") continue;
      seenUrls.add(normalizedUrl);

      const targetClean = brandDomain.toLowerCase().replace(/^www\./, "");
      const isBrandDomain = domain === targetClean || domain.endsWith(`.${targetClean}`);
      const isCompetitorDomain = competitorDomains.some((comp) => {
        const c = comp.toLowerCase().replace(/^www\./, "");
        return domain === c || domain.endsWith(`.${c}`);
      });

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
   * Computes cosine token overlap similarity bounded strictly in [0.0, 1.0].
   * Filters stop words to prevent common linguistic tokens from distorting attribution.
   */
  public static computeChunkAlignment(
    answerSnippet: string,
    sourcePageText: string,
    url: string
  ): ReverseRagAlignment {
    const { domain } = this.normalizeUrl(url);

    // Split source into semantic paragraphs
    const paragraphs = sourcePageText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 50);

    let bestScore = 0.0;
    let bestChunk = "";

    // Tokenize answer snippet into non-stop words
    const answerTokens = new Set(
      answerSnippet
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    );

    if (answerTokens.size === 0) {
      return {
        url,
        domain,
        sourceType: "unknown",
        extractedSnippet: answerSnippet.slice(0, 300),
        sourceChunkText: "",
        alignmentScore: 0.0,
        isSelfContained: false,
        wordCount: 0,
        attributionGap: "Empty content tokens for comparison.",
      };
    }

    for (const para of paragraphs) {
      const paraTokens = new Set(
        para
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
      );

      if (paraTokens.size === 0) continue;

      // Jaccard / Cosine intersection
      let intersection = 0;
      for (const t of paraTokens) {
        if (answerTokens.has(t)) intersection++;
      }

      // Cosine similarity: intersection / sqrt(|A| * |B|)
      const cosineSim = intersection / Math.sqrt(answerTokens.size * paraTokens.size);
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
      sourceType: "unknown",
      extractedSnippet: answerSnippet.slice(0, 300),
      sourceChunkText: bestChunk.slice(0, 500),
      alignmentScore: Number(bestScore.toFixed(3)),
      isSelfContained,
      wordCount,
      attributionGap,
    };
  }
}
