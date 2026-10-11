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
  | "recommended_primary"      // #1 Choice / Primary recommendation (weight +1.0)
  | "recommended_alternative"  // Viable runner-up / Alternative option (weight +0.5)
  | "neutral"                  // Factual citation / Neutral mention (weight 0.0)
  | "warning_caution"          // Criticism, high pricing, or caveat (weight -1.0)
  | "omitted";                 // Evaluated prompt where brand was missing (weight 0.0)

export type SourceCitationType =
  | "official_domain"
  | "software_review"   // G2, Capterra, Trustpilot, Product Hunt
  | "community_forum"   // Reddit, HackerNews, Quora
  | "editorial_press"   // TechCrunch, Forbes, VentureBeat, Medium
  | "competitor_domain"
  | "unknown";

export interface StanceMetrics {
  primaryCount: number;
  alternativeCount: number;
  neutralCount: number;
  warningCount: number;
  omittedCount: number;
  netStanceScore: number; // -1.0 to +1.0 (Enterprise Net Stance Score NSS)
}

export interface EngineVisibilityBreakdown {
  engine: EngineType;
  marketWeight: number; // 0.0 to 1.0 (e.g. Google AIO = 0.50, ChatGPT = 0.25)
  mentionRate: number;
  citationRate: number;
  prominenceScore: number;
  effectiveVisibilityIndex: number;
}

export interface EngineWeightedVisibility {
  aggregateEVI: number; // 0.0 to 1.0 (Market-share weighted Effective Visibility Index)
  breakdown: EngineVisibilityBreakdown[];
}

export interface ProbabilisticMetric {
  citationProbability: number; // 0.0 to 1.0 (Monte Carlo success frequency)
  wilsonInterval: [number, number]; // [lower, upper] 95% confidence interval with Yates correction
  mentionRate: number; // 0.0 to 1.0
  prominenceScore: number; // 0.0 to 1.0 position-weighted salience (lambda = 1.189)
  effectiveVisibilityIndex: number; // Unconditional expected prominence (p_mention * prominence)
  ndcpScore: number; // Normalized Discounted Cumulative Prominence
  volatilityStdDev: number; // Standard error across runs
  sampleCount: number; // N runs analyzed
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  stanceDistribution: StanceMetrics;
}

export interface CSoVEntityShare {
  entityName: string;
  isTargetBrand: boolean;
  citationShare: number; // Percentage 0 - 100 (Competitive Citation Share)
  prominenceShare: number; // Percentage 0 - 100 (True Prominence-Weighted Share)
  citationCount: number;
  topDomains: string[];
  netStanceScore?: number;
  rank?: number;
}

export interface CSoVAnalysisResult {
  entities: CSoVEntityShare[];
  totalCompetitiveCitations: number;
  editorialCitationsCount: number;
  editorialDilutionRate: number; // Percentage of citations going to 3rd party reviews/UGC
  totalMarketCitations: number;
}

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
  alignmentScore: number; // 0.0 - 1.0 (Bounded TF-IDF cosine similarity)
  isSelfContained: boolean; // 130 - 170 word self-contained unit test
  wordCount: number;
  attributionGap: string | null;
}
