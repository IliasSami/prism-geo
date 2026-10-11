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
    const sqlite = getRawDb();
    const activeBrand = getActiveBrand();

    let batch: any = null;
    if (batchId) {
      batch = sqlite.prepare("SELECT * FROM crawl_batches WHERE id = ?").get(batchId);
    } else if (activeBrand) {
      // Look for an active running batch first, otherwise the latest batch
      batch =
        sqlite
          .prepare(
            "SELECT * FROM crawl_batches WHERE brand_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
          )
          .get(activeBrand.id) ||
        sqlite
          .prepare(
            "SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .get(activeBrand.id);
    } else {
      batch =
        sqlite
          .prepare(
            "SELECT * FROM crawl_batches WHERE status = 'running' ORDER BY created_at DESC LIMIT 1"
          )
          .get() ||
        sqlite
          .prepare("SELECT * FROM crawl_batches ORDER BY created_at DESC LIMIT 1")
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

    // Check and auto-fail genuinely stale running batches (> 30 minutes old)
    if (batch.status === "running") {
      const ageMs = Date.now() - parseSqliteDate(batch.created_at);
      if (ageMs > 30 * 60 * 1000) {
        sqlite
          .prepare(
            `UPDATE crawl_batches SET status = 'failed', current_prompt = 'Batch timed out after 30 minutes', finished_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
          .run(batch.id);
        batch.status = "failed";
        batch.current_prompt = "Batch timed out after 30 minutes";
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
