import { getActiveBrand, getAllBrands, installFileLogging } from "@prismgeo/db";
import { CrawlerOrchestrator } from "./queue/crawler-orchestrator";
import { stalestPromptIds } from "./queue/scheduler";

/**
 * Headless crawl entry point, for servers and cron.
 *
 *   pnpm crawl                          all active prompts, every engine, 1 run each
 *   pnpm crawl --rolling=15             the 15 prompts measured longest ago (daily cron job)
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

  const validEngines = ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"] as const;
  type EngineType = (typeof validEngines)[number];
  const engines: EngineType[] = arg("engines")
    ? arg("engines")!.split(",").filter((e): e is EngineType => (validEngines as readonly string[]).includes(e))
    : [...validEngines];
  const sampleSize = Math.max(1, parseInt(arg("samples") || "1", 10));
  const rolling = arg("rolling") ? parseInt(arg("rolling")!, 10) : undefined;
  const promptLimit = arg("limit") ? parseInt(arg("limit")!, 10) : undefined;
  const promptIds = rolling ? stalestPromptIds(brand.id, rolling) : undefined;

  console.log(
    `[PrismGEO CLI] ${brand.name}: ${promptIds ? `${promptIds.length} stalest prompts` : promptLimit ? `first ${promptLimit} prompts` : "all active prompts"}, ` +
      `engines ${engines.join(", ")}, ${sampleSize} run(s) each`
  );
  const batchId = await CrawlerOrchestrator.executeBatch({ brandId: brand.id, sampleSize, promptLimit, promptIds, engines });
  console.log(`[PrismGEO CLI] Batch ${batchId} finished`);
}

main().catch((err) => {
  console.error("[PrismGEO CLI] Fatal error:", err);
  process.exit(1);
});
