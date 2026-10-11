import { NextResponse } from "next/server";
import { db, schema, eq, getActiveBrand, getRawDb } from "@prismgeo/db";
import { CrawlerOrchestrator } from "@prismgeo/crawler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const activeBrand = getActiveBrand();
    const brandId = body.brandId || activeBrand?.id;

    if (!brandId) {
      return NextResponse.json({ error: "No active brand selected" }, { status: 400 });
    }

    const brand = await db.query.brands.findFirst({
      where: eq(schema.brands.id, brandId),
    });

    if (!brand) {
      return NextResponse.json({ error: `Brand ${brandId} not found` }, { status: 404 });
    }

    const sampleSize = Number(body.sampleSize) || 3;
    const concurrency = Number(body.concurrency) || 2;
    const engines = Array.isArray(body.engines) && body.engines.length > 0
      ? body.engines
      : ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"];

    const prompts = await db.query.prompts.findMany({
      where: eq(schema.prompts.brandId, brandId),
    });

    const promptCount = body.promptLimit ? Math.min(prompts.length, Number(body.promptLimit)) : prompts.length;
    const totalRuns = promptCount * engines.length * sampleSize;

    const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const sqlite = getRawDb();

    sqlite
      .prepare(
        `INSERT INTO crawl_batches (id, brand_id, status, sample_size, total_runs, completed_runs, current_prompt, current_engine, created_at)
         VALUES (?, ?, 'running', ?, ?, 0, 'Initializing stealth contexts...', 'system', CURRENT_TIMESTAMP)`
      )
      .run(batchId, brandId, sampleSize, totalRuns);

    // Asynchronously kick off the crawl orchestration
    (async () => {
      try {
        await CrawlerOrchestrator.executeBatch({
          brandId,
          sampleSize,
          concurrency,
        });

        sqlite
          .prepare(
            `UPDATE crawl_batches SET status = 'completed', completed_runs = total_runs, current_prompt = 'Audit completed successfully', finished_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
          .run(batchId);
      } catch (err) {
        console.error("[Crawl Start Error]", err);
        sqlite
          .prepare(
            `UPDATE crawl_batches SET status = 'failed', current_prompt = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
          .run((err as Error).message, batchId);
      }
    })();

    return NextResponse.json({
      success: true,
      batchId,
      brandId,
      totalRuns,
      sampleSize,
      engines,
      status: "running",
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
