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

function parseSqliteDate(dateStr: string | null | undefined): number {
  if (!dateStr) return Date.now();
  if (dateStr.includes("Z") || dateStr.includes("+")) {
    return new Date(dateStr).getTime();
  }
  return new Date(dateStr.replace(" ", "T") + "Z").getTime();
}

    const sqlite = getRawDb();

    // Concurrency Lock: check if a batch is already currently running
    const runningBatch = sqlite
      .prepare(
        `SELECT id, created_at FROM crawl_batches WHERE status = 'running' ORDER BY created_at DESC LIMIT 1`
      )
      .get() as any;

    if (runningBatch && !body.force) {
      const batchAgeMs = Date.now() - parseSqliteDate(runningBatch.created_at);
      // If batch started less than 30 minutes ago, enforce lock
      if (batchAgeMs < 30 * 60 * 1000) {
        return NextResponse.json(
          {
            error: "A crawl batch is currently running. Please wait for it to complete.",
            runningBatchId: runningBatch.id,
          },
          { status: 409 }
        );
      } else {
        // Mark stale batch as failed
        sqlite
          .prepare(
            `UPDATE crawl_batches SET status = 'failed', current_prompt = 'Timed out after 30 minutes', finished_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
          .run(runningBatch.id);
      }
    }

    const sampleSize = Math.max(1, Math.min(20, Number(body.sampleSize) || 3));
    const concurrency = Math.max(1, Math.min(5, Number(body.concurrency) || 2));
    const engines = Array.isArray(body.engines) && body.engines.length > 0
      ? body.engines
      : ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"];

    const prompts = await db.query.prompts.findMany({
      where: eq(schema.prompts.brandId, brandId),
    });

    if (prompts.length === 0) {
      return NextResponse.json(
        { error: "No active prompts found for this brand. Please configure prompts or run the setup wizard first." },
        { status: 400 }
      );
    }

    const promptCount = body.promptLimit ? Math.min(prompts.length, Number(body.promptLimit)) : prompts.length;
    const totalRuns = promptCount * engines.length * sampleSize;

    const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    sqlite
      .prepare(
        `INSERT INTO crawl_batches (id, brand_id, status, sample_size, total_runs, completed_runs, current_prompt, current_engine, created_at)
         VALUES (?, ?, 'running', ?, ?, 0, 'Initializing stealth contexts...', 'system', ?)`
      )
      .run(batchId, brandId, sampleSize, totalRuns, nowIso);

    // Asynchronously kick off the crawl orchestration with matching batchId
    (async () => {
      try {
        await CrawlerOrchestrator.executeBatch({
          batchId,
          brandId,
          sampleSize,
          concurrency,
          engines,
          promptLimit: body.promptLimit ? Number(body.promptLimit) : undefined,
        });
      } catch (err) {
        console.error("[Crawl Start Background Error]", err);
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
