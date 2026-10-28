import { NextResponse } from "next/server";
import { db, schema, eq, getActiveBrand, getRawDb } from "@prismgeo/db";
import { CrawlerOrchestrator, closeStaleBatches, isProfileConnected } from "@prismgeo/crawler";

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

    const sqlite = getRawDb();

    // Concurrency lock. Batches whose process stopped (restart, killed CLI) stop sending
    // heartbeats and are closed as interrupted first, so they cannot block new audits.
    closeStaleBatches();
    const runningBatch = sqlite
      .prepare(`SELECT id FROM crawl_batches WHERE brand_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1`)
      .get(brandId) as { id: string } | undefined;

    if (runningBatch) {
      return NextResponse.json(
        {
          error: "A crawl batch is currently running. Please wait for it to complete.",
          runningBatchId: runningBatch.id,
        },
        { status: 409 }
      );
    }

    const sampleSize = Math.max(1, Math.min(20, Number(body.sampleSize) || 3));
    // Only known engines; Copilot only with a signed-in session (it has no logged-out chat)
    const KNOWN = ["perplexity", "google_aio", "copilot", "gemini", "chatgpt"] as const;
    type Engine = (typeof KNOWN)[number];
    const requested: string[] = Array.isArray(body.engines) && body.engines.length > 0 ? body.engines : KNOWN;
    const engines = [...new Set(requested)].filter(
      (e): e is Engine => (KNOWN as readonly string[]).includes(e) && (e !== "copilot" || isProfileConnected("copilot"))
    );
    if (engines.length === 0) {
      return NextResponse.json({ error: "Select at least one engine that can run" }, { status: 400 });
    }

    // Paused prompts are not crawled, so they do not count toward the batch size either
    const prompts = (
      await db.query.prompts.findMany({
        where: eq(schema.prompts.brandId, brandId),
      })
    ).filter((p: any) => p.active !== false);

    if (prompts.length === 0) {
      return NextResponse.json(
        { error: "No active prompts found for this brand. Please configure prompts or run the setup wizard first." },
        { status: 400 }
      );
    }

    const limit = Number.parseInt(String(body.promptLimit ?? ""), 10);
    const promptLimit = Number.isFinite(limit) && limit > 0 ? limit : undefined;
    const promptCount = promptLimit ? Math.min(prompts.length, promptLimit) : prompts.length;
    const totalRuns = promptCount * engines.length * sampleSize;

    const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    sqlite
      .prepare(
        `INSERT INTO crawl_batches (id, brand_id, status, sample_size, total_runs, completed_runs, current_prompt, current_engine, created_at)
         VALUES (?, ?, 'running', ?, ?, 0, 'Starting browsers...', 'system', ?)`
      )
      .run(batchId, brandId, sampleSize, totalRuns, nowIso);

    // Asynchronously kick off the crawl orchestration with matching batchId
    (async () => {
      try {
        await CrawlerOrchestrator.executeBatch({
          batchId,
          brandId,
          sampleSize,
          engines,
          promptLimit,
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
