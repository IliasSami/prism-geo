export type EngineType =
  | "perplexity"
  | "google_aio"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "copilot";

export type IntentType =
  | "dilemma"
  | "risk"
  | "pricing"
  | "comparison"
  | "direct"
  | "category"
  | "speed_to_lead"
  | "sdr_replacement"
  | "cart_recovery"
  | "crm_integration"
  | "latency_voice_tech"
  | "compliance_governance"
  | "tool_comparison";

export type PersonaDimension =
  | "agency_executive"
  | "growth_buyer"
  | "technical_lead"
  | "founder"
  | "founder_ceo"
  | "cro"
  | "vp_sales"
  | "head_of_growth"
  | "revops"
  | "sales_ops"
  | "plg_manager"
  | "marketing_leader"
  | "ecom_director";

export type SentimentType = "positive" | "neutral" | "negative";

export type StanceType =
  | "recommended_primary"      // #1 choice / primary recommendation
  | "recommended_alternative"  // Qualified recommendation ("best for X", runner-up)
  | "neutral"                  // Factual citation / Neutral mention
  | "warning_caution"          // Criticism, high pricing, or caveat without a recommendation
  | "omitted";                 // Evaluated prompt where brand was missing

export type SourceCitationType =
  | "official_domain"
  | "software_review"   // G2, Capterra, Trustpilot, Product Hunt
  | "community_forum"   // Reddit, HackerNews, Quora
  | "editorial_press"   // TechCrunch, Forbes, VentureBeat, Medium
  | "competitor_domain"
  | "unknown";

export interface SubQueryDecomposition {
  originalPrompt: string;
  decomposedSubQueries: string[];
  retrievalHitRate: number;
  targetBrandPresence: boolean;
}

export interface ReverseRagAlignment {
  url: string;
  domain: string;
  sourceType: SourceCitationType;
  extractedSnippet: string;
  sourceChunkText: string;
  alignmentScore: number; // 0.0 - 1.0 term-frequency cosine (no IDF) of the best answer sentence or the whole answer
  /** Content 3-gram shingles the matched passage shares with the answer. */
  sharedShingles: number;
  /** True when score >= 0.35 and >= 2 shared shingles: evidence the answer reused the passage. */
  isReuse: boolean;
  /** The answer sentence that best matches the passage. */
  answerSentence: string;
  isSelfContained: boolean; // 130 - 170 word self-contained unit test
  wordCount: number;
  attributionGap: string | null;
}
