import { NextResponse } from "next/server";
import { getRawDb, getActiveBrand } from "@prismgeo/db";
import { closeStaleBatches, engineRemedy } from "@prismgeo/crawler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const brandIdParam = searchParams.get("brandId");
    const sqlite = getRawDb();
    // A batch whose process died must not be reported as running forever
    closeStaleBatches();
    const activeBrand = getActiveBrand();
    const targetBrandId = brandIdParam || activeBrand?.id;

    let batch: any = null;
    if (batchId) {
      batch = sqlite.prepare("SELECT * FROM crawl_batches WHERE id = ?").get(batchId);
    } else if (targetBrandId) {
      // The running batch for this brand; falls back to its latest batch below
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

    if (!batch && targetBrandId) {
      batch = sqlite
        .prepare("SELECT * FROM crawl_batches WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(targetBrandId);
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

    // Dead batches are closed by closeStaleBatches() above (heartbeat-based). Age or quiet time
    // is not a signal: full audits run for hours and cool-downs are silent for up to 30 minutes.

    // Compute actual completed runs count from prompt_runs table for this batch
    const runCountRow = sqlite
      .prepare("SELECT count(*) as cnt FROM prompt_runs WHERE batch_id = ?")
      .get(batch.id) as any;
    const completedRuns = runCountRow?.cnt || batch.completed_runs || 0;
    const totalRuns = batch.total_runs || 0;
    const failedRuns = batch.failed_runs || 0;
    // Failed and skipped runs are finished too, so progress counts them alongside captured ones
    const percent =
      batch.status !== "running" ? 100 : totalRuns > 0 ? Math.min(99, Math.round(((completedRuns + failedRuns) / totalRuns) * 100)) : 0;

    // Why runs failed, grouped per engine, with what the user can do about it
    const issues = new Map<string, { engine: string; kind: string; count: number; example: string; remedy: string | null }>();
    try {
      for (const f of JSON.parse(batch.errors_json || "[]") as Array<{ engine: string; kind: string; message: string }>) {
        const key = `${f.engine}:${f.kind}`;
        const cur = issues.get(key);
        if (cur) cur.count++;
        else issues.set(key, { engine: f.engine, kind: f.kind, count: 1, example: String(f.message || "").slice(0, 200), remedy: engineRemedy(f.engine, f.kind) });
      }
    } catch {}

    return NextResponse.json({
      batchId: batch.id,
      brandId: batch.brand_id,
      status: batch.status,
      sampleSize: batch.sample_size,
      completedRuns,
      failedRuns,
      issues: [...issues.values()].sort((a, b) => b.count - a.count),
      totalRuns,
      percent,
      currentPrompt: batch.current_prompt || "Processing prompts...",
      currentEngine: batch.current_engine || "",
      createdAt: batch.created_at,
      finishedAt: batch.finished_at,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
