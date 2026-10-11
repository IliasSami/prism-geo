import type {
  ProbabilisticMetric,
  CSoVEntityShare,
  CSoVAnalysisResult,
  SentimentType,
  StanceType,
  StanceMetrics,
  EngineType,
  EngineWeightedVisibility,
} from "../types/index";

export class MonteCarloMetricsCalculator {
  /**
   * Wilson Score Interval (95% confidence) with Yates continuity correction.
   * Superior to normal approximation for N < 100 and boundary probabilities.
   */
  public static calculateWilsonInterval(
    successes: number,
    total: number,
    confidence = 1.96 // 95% confidence z-score
  ): [number, number] {
    if (total === 0) return [0, 0];

    // Exact small-sample boundaries
    if (successes === 0) {
      const upper = Math.min(1, 1 - Math.pow(0.05, 1 / total));
      return [0, Number(upper.toFixed(3))];
    }
    if (successes === total) {
      const lower = Math.max(0, Math.pow(0.05, 1 / total));
      return [Number(lower.toFixed(3)), 1];
    }

    const p = successes / total;
    const z = confidence;
    const z2 = z * z;
    const correction = 0.5 / total;

    const denominator = 1 + z2 / total;
    const center = p + z2 / (2 * total);
    const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);

    const lower = Math.max(0, (center - spread - correction) / denominator);
    const upper = Math.min(1, (center + spread + correction) / denominator);

    return [Number(lower.toFixed(3)), Number(upper.toFixed(3))];
  }

  /**
   * Calculates position-weighted prominence score (0.0 to 1.0).
   * Calibrated with lambda = 1.189 so that front 30% retains >= 0.70 weight.
   */
  public static calculateProminenceScore(
    mentionCharIndex: number,
    totalLength: number
  ): number {
    if (totalLength === 0 || mentionCharIndex < 0) return 0;
    const normalizedPosition = Math.min(1, Math.max(0, mentionCharIndex / totalLength));
    // lambda = 1.189 gives exactly exp(-1.189 * 0.30) = 0.7001
    return Number(Math.exp(-1.189 * normalizedPosition).toFixed(3));
  }

  /**
   * Normalized Discounted Cumulative Prominence (NDCP).
   * Models ordinal list rank discounting and entity frequency reinforcement.
   */
  public static calculateNDCP(
    rank: number,
    mentionCount = 1,
    totalMentionsInAnswer = 1,
    isDirectAnswer = false
  ): number {
    const validRank = Math.max(1, rank);
    // Discounted rank: #1 = 1.0, #2 = 0.63, #3 = 0.50, #4 = 0.43
    const rankWeight = 1.0 / Math.log2(validRank + 1);
    // Frequency density weight (up to 30% boost for repeated mentions)
    const freqWeight = Math.min(1.0, mentionCount / Math.max(1, totalMentionsInAnswer));

    let score = 0.70 * rankWeight + 0.30 * freqWeight;
    if (isDirectAnswer) {
      score = Math.min(1.0, score * 1.25);
    }
    return Number(score.toFixed(3));
  }

  /**
   * Rule-based Natural Language Stance Classifier.
   * Categorizes brand mention into Primary Recommendation, Alternative, Neutral, or Warning.
   */
  public static classifyStance(
    contextSnippet: string,
    entityName: string
  ): { stance: StanceType; sentiment: SentimentType; score: number } {
    const textLower = contextSnippet.toLowerCase();
    const entityLower = entityName.toLowerCase();

    // Check surrounding 200 character window of the entity mention
    const entityIdx = textLower.indexOf(entityLower);
    const windowStart = Math.max(0, entityIdx - 100);
    const windowEnd = Math.min(textLower.length, entityIdx + entityLower.length + 100);
    const window = textLower.slice(windowStart, windowEnd);

    // Negative / Warning indicators
    const warningSignals = [
      "however", "drawback", "expensive", "steep learning curve", "high latency",
      "lacks", "limited", "caution", "complaint", "poor", "not recommended", "struggles"
    ];
    if (warningSignals.some((w) => window.includes(w))) {
      return { stance: "warning_caution", sentiment: "negative", score: -1.0 };
    }

    // Primary Recommendation indicators
    const primarySignals = [
      "best overall", "top pick", "number one", "#1", "top recommendation",
      "leading platform", "best choice", "most recommended", "standout", "highest rated"
    ];
    if (primarySignals.some((p) => window.includes(p))) {
      return { stance: "recommended_primary", sentiment: "positive", score: 1.0 };
    }

    // Alternative / Runner-up indicators
    const alternativeSignals = [
      "alternative", "runner-up", "also consider", "worth considering", "viable option",
      "competitor to", "second choice", "other option", "specialized alternative"
    ];
    if (alternativeSignals.some((a) => window.includes(a))) {
      return { stance: "recommended_alternative", sentiment: "positive", score: 0.5 };
    }

    // Default neutral factual mention
    return { stance: "neutral", sentiment: "neutral", score: 0.0 };
  }

  /**
   * Aggregate multi-run batch into an Enterprise ProbabilisticMetric.
   * Corrects the conditioning fallacy by computing Effective Visibility Index (EVI).
   */
  public static computeProbabilisticMetric(
    runs: Array<{
      hasCitation: boolean;
      hasMention: boolean;
      mentionPosition?: number;
      responseLength?: number;
      rank?: number;
      contextSnippet?: string;
      entityName?: string;
      sentiment?: SentimentType;
    }>
  ): ProbabilisticMetric {
    const total = runs.length;
    if (total === 0) {
      return {
        citationProbability: 0,
        wilsonInterval: [0, 0],
        mentionRate: 0,
        prominenceScore: 0,
        effectiveVisibilityIndex: 0,
        ndcpScore: 0,
        volatilityStdDev: 0,
        sampleCount: 0,
        sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
        stanceDistribution: {
          primaryCount: 0,
          alternativeCount: 0,
          neutralCount: 0,
          warningCount: 0,
          omittedCount: 0,
          netStanceScore: 0,
        },
      };
    }

    const citationSuccesses = runs.filter((r) => r.hasCitation).length;
    const mentionSuccesses = runs.filter((r) => r.hasMention).length;

    const citationProbability = Number((citationSuccesses / total).toFixed(3));
    const mentionRate = Number((mentionSuccesses / total).toFixed(3));
    const wilsonInterval = this.calculateWilsonInterval(citationSuccesses, total);

    let totalProminence = 0;
    let prominenceSamples = 0;
    let totalNdcp = 0;

    const sentiments = { positive: 0, neutral: 0, negative: 0 };
    const stances = {
      primaryCount: 0,
      alternativeCount: 0,
      neutralCount: 0,
      warningCount: 0,
      omittedCount: total - mentionSuccesses,
    };
    let stanceScoreSum = 0;

    for (const run of runs) {
      if (run.hasMention) {
        if (run.mentionPosition !== undefined && run.responseLength) {
          totalProminence += this.calculateProminenceScore(run.mentionPosition, run.responseLength);
          prominenceSamples++;
        }
        const rank = run.rank || 1;
        totalNdcp += this.calculateNDCP(rank);

        // Classify stance
        const classified = run.contextSnippet && run.entityName
          ? this.classifyStance(run.contextSnippet, run.entityName)
          : {
              stance: run.sentiment === "positive" ? "recommended_primary" : "neutral",
              sentiment: run.sentiment || "neutral",
              score: run.sentiment === "positive" ? 1.0 : 0.0,
            };

        const sKey = (classified.sentiment === "positive" || classified.sentiment === "negative" ? classified.sentiment : "neutral") as keyof typeof sentiments;
        sentiments[sKey]++;
        if (classified.stance === "recommended_primary") stances.primaryCount++;
        else if (classified.stance === "recommended_alternative") stances.alternativeCount++;
        else if (classified.stance === "warning_caution") stances.warningCount++;
        else stances.neutralCount++;

        stanceScoreSum += classified.score;
      }
    }

    const avgProminence = prominenceSamples > 0
      ? Number((totalProminence / prominenceSamples).toFixed(3))
      : 0;

    // Effective Visibility Index (EVI): Unconditional expected prominence
    const effectiveVisibilityIndex = Number((mentionRate * avgProminence).toFixed(3));
    const ndcpScore = mentionSuccesses > 0 ? Number((totalNdcp / mentionSuccesses).toFixed(3)) : 0;

    // Net Stance Score (NSS) across mentions: -1.0 to +1.0
    const netStanceScore = mentionSuccesses > 0
      ? Number((stanceScoreSum / mentionSuccesses).toFixed(3))
      : 0;

    // Volatility: standard error across sample runs
    const p = citationProbability;
    const variance = (p * (1 - p)) / total;
    const volatilityStdDev = Number(Math.sqrt(variance).toFixed(3));

    return {
      citationProbability,
      wilsonInterval,
      mentionRate,
      prominenceScore: avgProminence,
      effectiveVisibilityIndex,
      ndcpScore,
      volatilityStdDev,
      sampleCount: total,
      sentimentDistribution: sentiments,
      stanceDistribution: {
        ...stances,
        netStanceScore,
      },
    };
  }

  /**
   * Computes Comprehensive Citation Share of Voice (CSoV) & Market Dilution.
   * Fixes zero-citation drop-out bug, calculates genuine prominence share, and accounts for editorial citations.
   */
  public static computeCSoV(
    targetBrand: string,
    brandCitations: number,
    competitors: Array<{
      name: string;
      citations: number;
      topDomains?: string[];
      avgProminence?: number;
      netStanceScore?: number;
    }>,
    editorialCitations = 0
  ): CSoVAnalysisResult {
    const totalCompetitiveCitations =
      brandCitations + competitors.reduce((acc, c) => acc + Math.max(0, c.citations), 0);
    const totalMarketCitations = totalCompetitiveCitations + Math.max(0, editorialCitations);

    const entities: CSoVEntityShare[] = [];

    // Calculate total weighted prominence points across competitive entities
    const brandProminenceWeight = brandCitations * 0.85; // Target brand prominence baseline
    let totalProminencePoints = brandProminenceWeight;
    for (const comp of competitors) {
      const compProm = comp.avgProminence || 0.65;
      totalProminencePoints += Math.max(0, comp.citations) * compProm;
    }

    if (totalCompetitiveCitations === 0) {
      // Return initialized 0% shares without dropping competitors
      entities.push({
        entityName: targetBrand,
        isTargetBrand: true,
        citationShare: 0,
        prominenceShare: 0,
        citationCount: 0,
        topDomains: [],
        rank: 1,
      });
      for (const comp of competitors) {
        entities.push({
          entityName: comp.name,
          isTargetBrand: false,
          citationShare: 0,
          prominenceShare: 0,
          citationCount: 0,
          topDomains: comp.topDomains || [],
          rank: 2,
        });
      }
      return {
        entities,
        totalCompetitiveCitations: 0,
        editorialCitationsCount: editorialCitations,
        editorialDilutionRate: 0,
        totalMarketCitations,
      };
    }

    // Target brand share
    const targetCitShare = Number(((brandCitations / totalCompetitiveCitations) * 100).toFixed(1));
    const targetPromShare = totalProminencePoints > 0
      ? Number(((brandProminenceWeight / totalProminencePoints) * 100).toFixed(1))
      : targetCitShare;

    entities.push({
      entityName: targetBrand,
      isTargetBrand: true,
      citationShare: targetCitShare,
      prominenceShare: targetPromShare,
      citationCount: brandCitations,
      topDomains: [],
    });

    // Competitor shares
    for (const comp of competitors) {
      const citCount = Math.max(0, comp.citations);
      const compCitShare = Number(((citCount / totalCompetitiveCitations) * 100).toFixed(1));
      const compPromWeight = citCount * (comp.avgProminence || 0.65);
      const compPromShare = totalProminencePoints > 0
        ? Number(((compPromWeight / totalProminencePoints) * 100).toFixed(1))
        : compCitShare;

      entities.push({
        entityName: comp.name,
        isTargetBrand: false,
        citationShare: compCitShare,
        prominenceShare: compPromShare,
        citationCount: citCount,
        topDomains: comp.topDomains || [],
        netStanceScore: comp.netStanceScore,
      });
    }

    // Sort by citation share descending and assign ranks
    entities.sort((a, b) => b.citationShare - a.citationShare);
    entities.forEach((e, idx) => {
      e.rank = idx + 1;
    });

    const editorialDilutionRate = totalMarketCitations > 0
      ? Number(((editorialCitations / totalMarketCitations) * 100).toFixed(1))
      : 0;

    return {
      entities,
      totalCompetitiveCitations,
      editorialCitationsCount: editorialCitations,
      editorialDilutionRate,
      totalMarketCitations,
    };
  }

  /**
   * Engine-Weighted AI Visibility Index (EWVI).
   * Weights visibility according to real-world search engine market shares.
   */
  public static computeEngineWeightedVisibility(
    engineBreakdowns: Array<{
      engine: EngineType;
      mentionRate: number;
      citationRate: number;
      prominenceScore: number;
    }>
  ): EngineWeightedVisibility {
    // Calibrated market weights (Google AIO: 50%, ChatGPT: 25%, Perplexity: 12%, Gemini: 8%, Copilot: 5%)
    const marketWeights: Record<EngineType, number> = {
      google_aio: 0.50,
      chatgpt: 0.25,
      perplexity: 0.12,
      gemini: 0.08,
      copilot: 0.05,
      claude: 0.00,
    };

    let totalWeight = 0;
    let weightedEVI = 0;

    const breakdown = engineBreakdowns.map((eb) => {
      const weight = marketWeights[eb.engine] ?? 0.10;
      totalWeight += weight;
      const evi = eb.mentionRate * eb.prominenceScore;
      weightedEVI += weight * evi;
      return {
        engine: eb.engine,
        marketWeight: weight,
        mentionRate: eb.mentionRate,
        citationRate: eb.citationRate,
        prominenceScore: eb.prominenceScore,
        effectiveVisibilityIndex: Number(evi.toFixed(3)),
      };
    });

    const aggregateEVI = totalWeight > 0 ? Number((weightedEVI / totalWeight).toFixed(3)) : 0;

    return {
      aggregateEVI,
      breakdown,
    };
  }
}
