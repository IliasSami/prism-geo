import { NextResponse } from "next/server";
import { getRawDb } from "@prismgeo/db";
import { closeStaleBatches, engineRemedy } from "@prismgeo/crawler";
import { route } from "../../_lib/http";
import { brandFromRequest, resolveBrand } from "../../_lib/brand";

export const dynamic = "force-dynamic";

interface BatchRow {
  id: string;
  brand_id: string;
  status: string;
  sample_size: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number | null;
  errors_json: string | null;
  current_prompt: string | null;
  current_engine: string | null;
  created_at: string;
  finished_at: string | null;
}

/**
 * Progress of an audit: ?batchId= for one batch, else the running (or latest) batch of ?brandId=
 * or of this browser's client. The response always has the same fields, also when idle.
 */
export const GET = route("crawl/status", async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  const brandIdParam = searchParams.get("brandId");
  const sqlite = getRawDb();
  // A batch whose process died must not be reported as running forever
  closeStaleBatches();

  let targetBrandId: string | undefined;
  if (brandIdParam) {
    const resolved = resolveBrand(request, brandIdParam);
    if (!resolved.ok) return resolved.response;
    targetBrandId = resolved.brand.id;
  } else {
    targetBrandId = brandFromRequest(request)?.id;
  }

  let batch: BatchRow | undefined;
  if (batchId) {
    batch = sqlite.prepare("SELECT * FROM crawl_batches WHERE id = ?").get(batchId) as BatchRow | undefined;
    if (!batch) return NextResponse.json({ error: "No audit with that id" }, { status: 404 });
  } else if (targetBrandId) {
    // The running batch for this brand, else its latest batch
    batch = (sqlite
      .prepare("SELECT * FROM crawl_batches WHERE brand_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
      .get(targetBrandId) ??
      sqlite.prepare("SELECT * FROM crawl_batches WHERE brand_id = ? AND COALESCE(owner, '') <> 'manual-capture' ORDER BY created_at DESC LIMIT 1").get(targetBrandId)) as
      | BatchRow
      | undefined;
  }

  if (!batch) {
    return NextResponse.json({
      batchId: null,
      brandId: targetBrandId ?? null,
      status: "idle",
      sampleSize: null,
      completedRuns: 0,
      failedRuns: 0,
      issues: [],
      totalRuns: 0,
      percent: 0,
      currentPrompt: "Ready for crawl run",
      currentEngine: "",
      createdAt: null,
      finishedAt: null,
    });
  }

  const completedRuns =
    (sqlite.prepare("SELECT count(*) AS n FROM prompt_runs WHERE batch_id = ?").get(batch.id) as { n: number }).n || batch.completed_runs || 0;
  const totalRuns = batch.total_runs || 0;
  const failedRuns = batch.failed_runs || 0;
  const running = batch.status === "running";
  // Failed and skipped runs are finished too, so progress counts them alongside captured ones
  const percent = !running ? 100 : totalRuns > 0 ? Math.min(99, Math.round(((completedRuns + failedRuns) / totalRuns) * 100)) : 0;

  // Why runs failed, grouped per engine, with what the user can do about it
  const issues = new Map<string, { engine: string; kind: string; count: number; example: string; remedy: string | null }>();
  let failures: Array<{ engine: string; kind: string; message: string }> = [];
  try {
    failures = JSON.parse(batch.errors_json || "[]");
  } catch (err) {
    console.error(`[api] crawl/status: unreadable errors_json on ${batch.id}`, err);
  }
  for (const f of failures) {
    const key = `${f.engine}:${f.kind}`;
    const cur = issues.get(key);
    if (cur) cur.count++;
    else issues.set(key, { engine: f.engine, kind: f.kind, count: 1, example: String(f.message || "").slice(0, 200), remedy: engineRemedy(f.engine, f.kind) });
  }

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
    currentPrompt: batch.current_prompt || (running ? "Processing prompts..." : ""),
    // A finished batch has no current engine, even if the last one is still stored
    currentEngine: running ? batch.current_engine || "" : "",
    createdAt: batch.created_at,
    finishedAt: batch.finished_at,
  });
});
