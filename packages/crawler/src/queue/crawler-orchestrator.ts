import { db, schema, eq } from "@prismgeo/db";
import { ReverseRagParser, MonteCarloMetricsCalculator } from "@prismgeo/core";
import { PerplexityEngineCrawler } from "../engines/perplexity";
import { GoogleAioCrawler } from "../engines/google-aio";
import { CopilotEngineCrawler } from "../engines/copilot";
import { GeminiEngineCrawler } from "../engines/gemini";
import { ChatGptEngineCrawler } from "../engines/chatgpt";
import { chromium, type Browser } from "playwright";
import { getChromiumExecutablePath } from "../stealth/fingerprint";
import crypto from "node:crypto";

export interface CrawlBatchOptions {
  batchId?: string;
  brandId: string;
  sampleSize?: number; // Monte Carlo N runs
  concurrency?: number; // Browser tabs concurrency
  engines?: Array<"perplexity" | "google_aio" | "copilot" | "gemini" | "chatgpt">;
  promptLimit?: number;
}

export class CrawlerOrchestrator {
  public static async executeBatch(options: CrawlBatchOptions): Promise<string> {
    const brandId = options.brandId;
    const sampleSize = options.sampleSize || 5;
    const engines = options.engines || ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"];

    // 1. Fetch brand and competitor configurations
    const brand = await db.query.brands.findFirst({
      where: eq(schema.brands.id, brandId),
    });

    if (!brand) throw new Error(`Brand not found: ${brandId}`);

    const brandAliases: string[] = JSON.parse(brand.aliasesJson || "[]");
    brandAliases.push(brand.name);

    const competitors = await db.query.competitors.findMany({
      where: eq(schema.competitors.brandId, brandId),
    });
    const competitorDomains = competitors.map((c: any) => c.domain);

    const rawPrompts = await db.query.prompts.findMany({
      where: eq(schema.prompts.brandId, brandId),
    });

    if (rawPrompts.length === 0) {
      throw new Error(`No active prompts configured for brand ${brandId}`);
    }

    const activePrompts = options.promptLimit
      ? rawPrompts.slice(0, options.promptLimit)
      : rawPrompts;

    // 2. Resolve or create batch record
    const batchId = options.batchId || `batch-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const totalRuns = activePrompts.length * engines.length * sampleSize;

    const existingBatch = await db.query.crawlBatches.findFirst({
      where: eq(schema.crawlBatches.id, batchId),
    });

    if (existingBatch) {
      await db
        .update(schema.crawlBatches)
        .set({
          status: "running",
          sampleSize,
          totalRuns,
          currentPrompt: "Initializing stealth crawler engines...",
          currentEngine: engines[0] || "system",
        })
        .where(eq(schema.crawlBatches.id, batchId));
    } else {
      await db.insert(schema.crawlBatches).values({
        id: batchId,
        brandId,
        status: "running",
        sampleSize,
        totalRuns,
        completedRuns: 0,
        currentPrompt: "Initializing stealth crawler engines...",
        currentEngine: engines[0] || "system",
      });
    }

    console.log(`[CrawlerOrchestrator] Started batch ${batchId} for ${brand.name} (${activePrompts.length} prompts across ${engines.length} engines, N=${sampleSize})`);

    let completedRuns = 0;
    let sharedBrowser: Browser | null = null;

    try {
      try {
        sharedBrowser = await chromium.launch({
          headless: true,
          executablePath: getChromiumExecutablePath(),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
          ],
        });
      } catch (browserLaunchErr) {
        console.warn("[CrawlerOrchestrator] Browser launch note:", (browserLaunchErr as Error).message);
      }

      // Process prompts with concurrent engine execution
      for (const prompt of activePrompts) {
        await Promise.all(
          engines.map(async (engine) => {
            for (let runIdx = 0; runIdx < sampleSize; runIdx++) {
              const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

              // Update live progress markers
              await db
                .update(schema.crawlBatches)
                .set({
                  currentPrompt: prompt.queryText.slice(0, 80),
                  currentEngine: engine,
                })
                .where(eq(schema.crawlBatches.id, batchId));

            try {
              let engineResult: {
                responseText: string;
                citations: Array<{ url: string; title: string }>;
                subQueries: string[];
                executionMs: number;
              };

              if (engine === "perplexity") {
                engineResult = await PerplexityEngineCrawler.execute(prompt.queryText, sharedBrowser || undefined);
              } else if (engine === "copilot") {
                engineResult = await CopilotEngineCrawler.execute(prompt.queryText, sharedBrowser || undefined);
              } else if (engine === "gemini") {
                engineResult = await GeminiEngineCrawler.execute(prompt.queryText, sharedBrowser || undefined);
              } else if (engine === "chatgpt") {
                engineResult = await ChatGptEngineCrawler.execute(prompt.queryText, sharedBrowser || undefined);
              } else {
                engineResult = await GoogleAioCrawler.execute(prompt.queryText, sharedBrowser || undefined);
              }

              // Save Prompt Run with explicit brandId
              await db.insert(schema.promptRuns).values({
                id: runId,
                brandId,
                batchId,
                promptId: prompt.id,
                engine,
                runIndex: runIdx,
                responseText: engineResult.responseText,
                subQueriesJson: JSON.stringify(engineResult.subQueries),
                executionMs: engineResult.executionMs,
              });

              // Extract Citations from response text + engine links
              const combinedText = `${engineResult.responseText} ${engineResult.citations.map((c) => c.url).join(" ")}`;
              const extractedCitations = ReverseRagParser.extractCitationsFromText(
                combinedText,
                brand.domain,
                competitorDomains
              );

              for (const cit of extractedCitations) {
                const citId = `cit-${crypto.randomBytes(6).toString("hex")}`;
                await db.insert(schema.citations).values({
                  id: citId,
                  brandId,
                  runId,
                  domain: cit.domain,
                  url: cit.url,
                  title: cit.anchorText || cit.domain,
                  anchorText: cit.anchorText,
                  rank: cit.rank,
                  isBrandDomain: cit.isBrandDomain,
                  isCompetitorDomain: cit.isCompetitorDomain,
                });

                // Populate Reverse-RAG Chunks for brand and top citations
                if (cit.isBrandDomain || cit.rank <= 2) {
                  const alignment = ReverseRagParser.computeChunkAlignment(
                    engineResult.responseText,
                    engineResult.responseText, // aligned against retrieved context
                    cit.url
                  );

                  await db.insert(schema.reverseRagChunks).values({
                    id: `chk-${crypto.randomBytes(6).toString("hex")}`,
                    brandId,
                    runId,
                    citationId: citId,
                    sourceUrl: cit.url,
                    matchedChunkText: alignment.sourceChunkText || engineResult.responseText.slice(0, 300),
                    similarityScore: alignment.alignmentScore,
                    selfContainedScore: alignment.isSelfContained ? 1.0 : 0.5,
                  });
                }
              }

              // Detect Target Brand Mentions & Stance
              const fullTextLower = engineResult.responseText.toLowerCase();
              const brandMentioned = brandAliases.some((alias) =>
                fullTextLower.includes(alias.toLowerCase())
              );

              if (brandMentioned) {
                const firstPos = brandAliases.reduce((minPos, alias) => {
                  const pos = fullTextLower.indexOf(alias.toLowerCase());
                  return pos >= 0 && (minPos === -1 || pos < minPos) ? pos : minPos;
                }, -1);

                const prominence =
                  firstPos >= 0
                    ? MonteCarloMetricsCalculator.calculateProminenceScore(firstPos, engineResult.responseText.length)
                    : 0.70;

                const stanceInfo = MonteCarloMetricsCalculator.classifyStance(
                  engineResult.responseText,
                  brand.name
                );

                await db.insert(schema.entityMentions).values({
                  id: `ent-${crypto.randomBytes(6).toString("hex")}`,
                  brandId,
                  runId,
                  entityName: brand.name,
                  isTargetBrand: true,
                  isCompetitor: false,
                  sentiment: stanceInfo.sentiment,
                  prominenceScore: prominence,
                  positionRank: stanceInfo.stance === "recommended_primary" ? 1 : 2,
                });
              }

              // Check competitor mentions & Stances
              for (const comp of competitors) {
                if (fullTextLower.includes(comp.name.toLowerCase())) {
                  const compStance = MonteCarloMetricsCalculator.classifyStance(
                    engineResult.responseText,
                    comp.name
                  );

                  await db.insert(schema.entityMentions).values({
                    id: `ent-${crypto.randomBytes(6).toString("hex")}`,
                    brandId,
                    runId,
                    entityName: comp.name,
                    isTargetBrand: false,
                    isCompetitor: true,
                    sentiment: compStance.sentiment,
                    prominenceScore: 0.65,
                    positionRank: compStance.stance === "recommended_primary" ? 1 : 2,
                  });
                }
              }

              completedRuns++;
              await db
                .update(schema.crawlBatches)
                .set({ completedRuns })
                .where(eq(schema.crawlBatches.id, batchId));

              // Polite jitter between browser actions (200ms - 500ms)
              await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
              } catch (runErr) {
                console.error(`[CrawlerOrchestrator] Error on prompt ${prompt.id} run ${runIdx}:`, runErr);
              }
            }
          })
        );
      }

      // Mark batch finished
      const finalStatus = completedRuns > 0 ? "completed" : "failed";
      await db
        .update(schema.crawlBatches)
        .set({
          status: finalStatus,
          currentPrompt: finalStatus === "completed" ? "Audit completed successfully" : "Batch completed with zero successful runs",
          finishedAt: new Date().toISOString(),
        })
        .where(eq(schema.crawlBatches.id, batchId));

      console.log(`[CrawlerOrchestrator] Finished batch ${batchId} (${completedRuns} runs)`);
      return batchId;
    } catch (batchFatalErr) {
      console.error(`[CrawlerOrchestrator] Fatal error on batch ${batchId}:`, batchFatalErr);
      await db
        .update(schema.crawlBatches)
        .set({
          status: "failed",
          currentPrompt: (batchFatalErr as Error).message,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(schema.crawlBatches.id, batchId));
      throw batchFatalErr;
    } finally {
      if (sharedBrowser) {
        try {
          await sharedBrowser.close();
        } catch (closeErr) {
          console.warn("[CrawlerOrchestrator] Browser close warning:", (closeErr as Error).message);
        }
      }
    }
  }
}
