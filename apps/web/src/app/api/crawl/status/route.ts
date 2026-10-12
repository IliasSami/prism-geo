import { NextResponse } from "next/server";
import { getRawDb, getActiveBrand } from "@prismgeo/db";

export const dynamic = "force-dynamic";

function parseSqliteDate(dateStr: string | null | undefined): number {
  if (!dateStr) return Date.now();
  if (dateStr.includes("Z") || dateStr.includes("+")) {
    return new Date(dateStr).getTime();
  }
  return new Date(dateStr.replace(" ", "T") + "Z").getTime();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const brandIdParam = searchParams.get("brandId");
    const sqlite = getRawDb();
    const activeBrand = getActiveBrand();
    const targetBrandId = brandIdParam || activeBrand?.id;

    let batch: any = null;
    if (batchId) {
      batch = sqlite.prepare("SELECT * FROM crawl_batches WHERE id = ?").get(batchId);
    } else if (targetBrandId) {
      // ONLY look for an actively running batch for this brand!
      batch = sqlite
        .prepare(
          "SELECT * FROM crawl_batches WHERE brand_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
        )
        .get(targetBrandId);
    } else {
      batch = sqlite
        .prepare(
          "SELECT * FROM crawl_batches WHERE status = 'running' ORDER BY created_at DESC LIMIT 1"
        )
        .get();
    }

    if (!batch) {
      return NextResponse.json({
        status: "idle",
        completedRuns: 0,
        totalRuns: 0,
        percent: 0,
        currentPrompt: "Ready for crawl run",
        currentEngine: "idle",
      });
    }

    // Check and auto-fail genuinely abandoned running batches (no activity in 15 mins or > 2 hrs old)
    if (batch.status === "running") {
      const lastRunRow = sqlite
        .prepare("SELECT created_at FROM prompt_runs WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(batch.id) as any;
      const lastActivityMs = lastRunRow
        ? parseSqliteDate(lastRunRow.created_at)
        : parseSqliteDate(batch.created_at);
      const inactiveMs = Date.now() - lastActivityMs;
      const totalAgeMs = Date.now() - parseSqliteDate(batch.created_at);

      if (inactiveMs > 15 * 60 * 1000 || totalAgeMs > 2 * 60 * 60 * 1000) {
        sqlite
          .prepare(
            `UPDATE crawl_batches SET status = 'failed', current_prompt = 'Batch abandoned after inactivity', finished_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
          .run(batch.id);
        batch.status = "failed";
        batch.current_prompt = "Batch abandoned after inactivity";
      }
    }

    // Compute actual completed runs count from prompt_runs table for this batch
    const runCountRow = sqlite
      .prepare("SELECT count(*) as cnt FROM prompt_runs WHERE batch_id = ?")
      .get(batch.id) as any;
    const completedRuns = runCountRow?.cnt || batch.completed_runs || 0;
    const totalRuns = batch.total_runs || (batch.sample_size * 5) || 10;
    const percent = batch.status === "completed"
      ? 100
      : totalRuns > 0
      ? Math.min(99, Math.round((completedRuns / totalRuns) * 100))
      : 0;

    return NextResponse.json({
      batchId: batch.id,
      brandId: batch.brand_id,
      status: batch.status,
      sampleSize: batch.sample_size,
      completedRuns,
      totalRuns,
      percent,
      currentPrompt: batch.current_prompt || "Processing prompts...",
      currentEngine: batch.current_engine || "perplexity",
      createdAt: batch.created_at,
      finishedAt: batch.finished_at,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
