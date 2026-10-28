import type {
  ProbabilisticMetric,
  CSoVEntityShare,
  CSoVAnalysisResult,
  IntentStratification,
  SentimentType,
  StanceType,
  StanceMetrics,
  EngineType,
  EngineWeightedVisibility,
} from "../types/index";

export class MonteCarloMetricsCalculator {
  /**
   * Two-sided Wilson score interval (95% by default). Well behaved for small n and for rates at
   * 0 or 1, where the normal approximation collapses to a zero-width range.
   */
  public static calculateWilsonInterval(
    successes: number,
    total: number,
    confidence = 1.96 // 95% confidence z-score
  ): [number, number] {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(successes) || successes < 0) {
      return [0, 0];
    }
    const k = Math.min(total, Math.max(0, successes));
    const p = k / total;
    const z2 = confidence * confidence;
    const denominator = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / denominator;
    const spread = (confidence * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
    const lower = k === 0 ? 0 : Math.max(0, center - spread);
    const upper = k === total ? 1 : Math.min(1, center + spread);
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
    if (!Number.isFinite(totalLength) || totalLength <= 0 || !Number.isFinite(mentionCharIndex) || mentionCharIndex < 0) {
      return 0;
    }
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
    const validRank = Math.max(1, Number.isFinite(rank) ? rank : 1);
    const safeMentionCount = Math.max(0, Number.isFinite(mentionCount) ? mentionCount : 1);
    const safeTotalMentions = Math.max(1, Number.isFinite(totalMentionsInAnswer) ? totalMentionsInAnswer : 1);
    // Discounted rank: #1 = 1.0, #2 = 0.63, #3 = 0.50, #4 = 0.43
    const rankWeight = 1.0 / Math.log2(validRank + 1);
    // Frequency density weight (up to 30% boost for repeated mentions)
    const freqWeight = Math.min(1.0, safeMentionCount / safeTotalMentions);

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
    if (!contextSnippet || !entityName) {
      return { stance: "neutral", sentiment: "neutral", score: 0.0 };
    }

    const textLower = contextSnippet.toLowerCase();
    const entityLower = entityName.toLowerCase();

    // Verify the entity is actually present in the snippet
    const entityIdx = textLower.indexOf(entityLower);
    if (entityIdx === -1) {
      return { stance: "neutral", sentiment: "neutral", score: 0.0 };
    }

    // Scope to the line (list item / paragraph) holding the mention so signals from neighbouring
    // vendors in a list do not bleed in. A short line that is not a sentence is treated as a list
    // heading and read together with its description line; a long paragraph is narrowed to the sentence.
    const lineStart = textLower.lastIndexOf("\n", entityIdx) + 1;
    let lineEnd = textLower.indexOf("\n", entityIdx);
    if (lineEnd === -1) lineEnd = textLower.length;
    const line = textLower.slice(lineStart, lineEnd).trim();
    // A heading is short and is not itself a sentence ("2. Globex AI", "Globex (globex.example)")
    const isHeading = line.length < 60 && !/[.!?]$/.test(line) && !/[.!?]\s/.test(line);
    if (isHeading && lineEnd < textLower.length) {
      const nextEnd = textLower.indexOf("\n", lineEnd + 1);
      lineEnd = nextEnd === -1 ? textLower.length : nextEnd;
    }
    let window = textLower.slice(lineStart, lineEnd);
    if (window.length > 300) {
      const rel = entityIdx - lineStart;
      const sentStart = Math.max(window.lastIndexOf(". ", rel), window.lastIndexOf("? ", rel), window.lastIndexOf("! ", rel)) + 1;
      const ends = [". ", "? ", "! "].map((p) => window.indexOf(p, rel + entityLower.length)).filter((i) => i !== -1);
      window = window.slice(sentStart, ends.length ? Math.min(...ends) + 1 : window.length);
    }

    // Negative / Warning indicators
    const warningSignals = [
      "drawback", "expensive", "steep learning curve", "high latency",
      "lacks", "limited", "caution", "complaint", "poor", "not recommended", "struggles"
    ];
    if (warningSignals.some((w) => (w === "limited" ? /\blimited\b/.test(window) : window.includes(w)))) {
      return { stance: "warning_caution", sentiment: "negative", score: -1.0 };
    }

    // Primary Recommendation indicators
    const primarySignals = [
      "best overall", "top pick", "number one", "#1", "top recommendation",
      "leading platform", "best choice", "most recommended", "standout", "highest rated",
      // Phrasings observed in live ChatGPT / Gemini / Perplexity answers
      "best starting point", "best dedicated", "top choice", "start with", "i'd shortlist", "best fit",
      "best direct fit", "best option", "my pick", "strongest option"
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
        conditionalNdcpScore: 0,
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
              stance: run.sentiment === "positive" ? "recommended_primary" : run.sentiment === "negative" ? "warning_caution" : "neutral",
              sentiment: run.sentiment || "neutral",
              score: run.sentiment === "positive" ? 1.0 : run.sentiment === "negative" ? -1.0 : 0.0,
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

    // Effective Visibility Index (EVI): Unconditional expected prominence E[Prominence] = P(Mention) * E[Prominence | Mention]
    const effectiveVisibilityIndex = Number((mentionRate * avgProminence).toFixed(3));
    // Conditional NDCP: Rank discount given mention
    const conditionalNdcp = mentionSuccesses > 0 ? Number((totalNdcp / mentionSuccesses).toFixed(3)) : 0;
    // Unconditional Effective NDCP: Expected rank discount across entire search corpus
    const effectiveNdcp = Number((mentionRate * conditionalNdcp).toFixed(3));

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
      ndcpScore: effectiveNdcp,
      conditionalNdcpScore: conditionalNdcp,
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
   * Computes Comprehensive Citation Share of Voice (CSoV), Market Dilution,
   * Bayesian Dirichlet/Laplace Smoothed Competitive Share, and Stratified Intent SoV.
   * Eliminates the conditioning fallacy (e.g. 4 / (4 + 0) = 100%) and delivers authentic enterprise metrics.
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
    editorialCitations = 0,
    options?: {
      bayesianAlpha?: number;
      targetBrandProminence?: number;
      intentRuns?: Array<{
        isBranded: boolean;
        hasBrandCitation: boolean;
        totalCitationsInRun?: number;
      }>;
    }
  ): CSoVAnalysisResult {
    const safeBrandCitations = Math.max(0, Number.isFinite(brandCitations) ? brandCitations : 0);
    const safeEditorialCitations = Math.max(0, Number.isFinite(editorialCitations) ? editorialCitations : 0);
    const safeCompetitors = Array.isArray(competitors)
      ? competitors.map((c) => ({
          name: c.name || "Competitor",
          citations: Math.max(0, Number.isFinite(c.citations) ? c.citations : 0),
          topDomains: Array.isArray(c.topDomains) ? c.topDomains : [],
          avgProminence: Number.isFinite(c.avgProminence) ? c.avgProminence : 0.65,
          netStanceScore: c.netStanceScore,
        }))
      : [];

    const totalCompetitiveCitations =
      safeBrandCitations + safeCompetitors.reduce((acc, c) => acc + c.citations, 0);
    const totalMarketCitations = totalCompetitiveCitations + safeEditorialCitations;

    // Entity count K (brand + competitors)
    const entityCount = 1 + safeCompetitors.length;
    // Bayesian Laplace/Dirichlet prior parameter (default alpha = 1.0)
    const alpha = Math.max(0.1, Number.isFinite(options?.bayesianAlpha) ? (options!.bayesianAlpha as number) : 1.0);
    // Total smoothed pseudo-observations: total + K * alpha
    const smoothedCompetitiveDenominator = totalCompetitiveCitations + entityCount * alpha;
    // Credence weight: how much empirical observations outweigh the prior (0.0 to 1.0)
    const sampleCredenceWeight = Number((totalCompetitiveCitations / smoothedCompetitiveDenominator).toFixed(3));

    // Market Citation Share: Target Brand Share of ALL Citations (including Editorial / UGC / Reviews)
    const marketCitationShareBrand = totalMarketCitations > 0
      ? Number(((safeBrandCitations / totalMarketCitations) * 100).toFixed(1))
      : 0;
    const editorialShare = totalMarketCitations > 0
      ? Number(((safeEditorialCitations / totalMarketCitations) * 100).toFixed(1))
      : 0;

    const entities: CSoVEntityShare[] = [];

    // Prominence points weighting
    const brandPromScore = options?.targetBrandProminence ?? 0.85;
    const brandProminenceWeight = safeBrandCitations * brandPromScore;
    let totalProminencePoints = brandProminenceWeight;
    for (const comp of safeCompetitors) {
      const compProm = comp.avgProminence || 0.65;
      totalProminencePoints += comp.citations * compProm;
    }
    const smoothedPromDenominator = totalProminencePoints + entityCount * alpha * 0.75;

    // Target brand shares
    // 1. Bayesian smoothed competitive share: (brand + alpha) / (total + K * alpha)
    const targetSmoothedShare = Number((((safeBrandCitations + alpha) / smoothedCompetitiveDenominator) * 100).toFixed(1));
    // 2. Raw frequentist competitive share (when total > 0)
    const targetRawShare = totalCompetitiveCitations > 0
      ? Number(((safeBrandCitations / totalCompetitiveCitations) * 100).toFixed(1))
      : Number((100 / entityCount).toFixed(1));
    // 3. Absolute market citation share
    const targetMarketShare = marketCitationShareBrand;
    // 4. Prominence share (Bayesian smoothed)
    const targetPromShare = totalProminencePoints > 0
      ? Number((((brandProminenceWeight + alpha * brandPromScore) / smoothedPromDenominator) * 100).toFixed(1))
      : targetSmoothedShare;

    entities.push({
      entityName: targetBrand,
      isTargetBrand: true,
      citationShare: targetSmoothedShare,
      rawCitationShare: targetRawShare,
      marketCitationShare: targetMarketShare,
      prominenceShare: targetPromShare,
      citationCount: safeBrandCitations,
      topDomains: [],
    });

    // Competitor shares
    for (const comp of safeCompetitors) {
      const citCount = comp.citations;
      const compSmoothedShare = Number((((citCount + alpha) / smoothedCompetitiveDenominator) * 100).toFixed(1));
      const compRawShare = totalCompetitiveCitations > 0
        ? Number(((citCount / totalCompetitiveCitations) * 100).toFixed(1))
        : Number((100 / entityCount).toFixed(1));
      const compMarketShare = totalMarketCitations > 0
        ? Number(((citCount / totalMarketCitations) * 100).toFixed(1))
        : 0;

      const compPromScore = comp.avgProminence || 0.65;
      const compPromWeight = citCount * compPromScore;
      const compPromShare = totalProminencePoints > 0
        ? Number((((compPromWeight + alpha * compPromScore) / smoothedPromDenominator) * 100).toFixed(1))
        : compSmoothedShare;

      entities.push({
        entityName: comp.name,
        isTargetBrand: false,
        citationShare: compSmoothedShare,
        rawCitationShare: compRawShare,
        marketCitationShare: compMarketShare,
        prominenceShare: compPromShare,
        citationCount: citCount,
        topDomains: comp.topDomains,
        netStanceScore: comp.netStanceScore,
      });
    }

    // Sort by citationShare (Bayesian smoothed) descending and assign ranks
    entities.sort((a, b) => b.citationShare - a.citationShare);
    entities.forEach((e, idx) => {
      e.rank = idx + 1;
    });

    // Intent breakdown if intentRuns supplied
    let intentBreakdown: IntentStratification | undefined;
    if (options?.intentRuns && options.intentRuns.length > 0) {
      const brandedRuns = options.intentRuns.filter((r) => r.isBranded);
      const nonBrandedRuns = options.intentRuns.filter((r) => !r.isBranded);

      const bBrandCits = brandedRuns.filter((r) => r.hasBrandCitation).length;
      const bTotalCits = brandedRuns.reduce((acc, r) => acc + (r.totalCitationsInRun || 1), 0);

      const nbBrandCits = nonBrandedRuns.filter((r) => r.hasBrandCitation).length;
      const nbTotalCits = nonBrandedRuns.reduce((acc, r) => acc + (r.totalCitationsInRun || 1), 0);

      const brandedSoV = bTotalCits > 0 ? Number(((bBrandCits / bTotalCits) * 100).toFixed(1)) : 0;
      const nonBrandedSoV = nbTotalCits > 0 ? Number(((nbBrandCits / nbTotalCits) * 100).toFixed(1)) : 0;

      const wNb = nonBrandedRuns.length > 0 && brandedRuns.length > 0 ? 0.70 : nonBrandedRuns.length > 0 ? 1.0 : 0.0;
      const wB = nonBrandedRuns.length > 0 && brandedRuns.length > 0 ? 0.30 : brandedRuns.length > 0 ? 1.0 : 0.0;
      const blendedSoV = Number((wNb * nonBrandedSoV + wB * brandedSoV).toFixed(1));

      intentBreakdown = {
        nonBrandedSoV,
        brandedSoV,
        blendedSoV,
        nonBrandedPromptCount: nonBrandedRuns.length,
        brandedPromptCount: brandedRuns.length,
        nonBrandedBrandCitations: nbBrandCits,
        nonBrandedTotalCitations: nbTotalCits,
        brandedBrandCitations: bBrandCits,
        brandedTotalCitations: bTotalCits,
        weights: {
          nonBranded: wNb,
          branded: wB,
        },
      };
    }

    const editorialDilutionRate = editorialShare;

    return {
      entities,
      totalCompetitiveCitations,
      editorialCitationsCount: safeEditorialCitations,
      editorialDilutionRate,
      totalMarketCitations,
      marketCitationShareBrand,
      editorialShare,
      bayesianPriorAlpha: alpha,
      sampleCredenceWeight,
      intentBreakdown,
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
