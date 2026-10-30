import { ENGINE_IDS } from "@prismgeo/core";
import { getActiveBrand, getAllBrands, installFileLogging } from "@prismgeo/db";
import { CrawlerOrchestrator, BatchRunningError, recoverInterruptedBatches } from "./queue/crawler-orchestrator";
import { stalestPromptIdsByEngine } from "./queue/scheduler";

/**
 * Headless crawl entry point, for servers and cron.
 *
 *   pnpm crawl                          all active prompts, every engine, 1 run each
 *   pnpm crawl --rolling=15             per engine, the 15 prompts it measured longest ago (daily cron job)
 *   pnpm crawl --engines=chatgpt,gemini --samples=3 --limit=10 --brand=<id or slug>
 */
async function main() {
  installFileLogging("cli");
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

  const brandArg = arg("brandId") || arg("brand");
  const brand = brandArg ? getAllBrands().find((b) => b.id === brandArg || b.slug === brandArg) : getActiveBrand() || getAllBrands()[0];
  if (!brand) {
    console.error("No brand found. Create a client in the web app's /setup wizard first.");
    process.exit(1);
  }

  const validEngines = ENGINE_IDS;
  type EngineType = (typeof validEngines)[number];
  const engines: EngineType[] = arg("engines")
    ? arg("engines")!.split(",").filter((e): e is EngineType => (validEngines as readonly string[]).includes(e))
    : [...validEngines];
  const sampleSize = Math.max(1, parseInt(arg("samples") || "1", 10));
  const rolling = arg("rolling") ? parseInt(arg("rolling")!, 10) : undefined;
  const promptLimit = arg("limit") ? parseInt(arg("limit")!, 10) : undefined;
  const promptIdsByEngine = rolling ? stalestPromptIdsByEngine(brand.id, engines, rolling) : undefined;
  recoverInterruptedBatches();

  console.log(
    `[PrismGEO CLI] ${brand.name}: ${promptIdsByEngine ? `${rolling} stalest prompts per engine` : promptLimit ? `first ${promptLimit} prompts` : "all active prompts"}, ` +
      `engines ${engines.join(", ")}, ${sampleSize} run(s) each`
  );
  try {
    const batchId = await CrawlerOrchestrator.executeBatch({ brandId: brand.id, sampleSize, promptLimit, promptIdsByEngine, engines });
    console.log(`[PrismGEO CLI] Batch ${batchId} finished`);
  } catch (err) {
    if (err instanceof BatchRunningError) {
      console.error(`[PrismGEO CLI] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("[PrismGEO CLI] Fatal error:", err);
  process.exit(1);
});
