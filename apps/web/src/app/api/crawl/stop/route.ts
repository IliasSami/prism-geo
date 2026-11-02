import { NextResponse } from "next/server";
import { z } from "zod";
import { CrawlerOrchestrator } from "@prismgeo/crawler";
import { jsonError, parseBody, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ batchId: z.string({ error: "batchId is required" }).min(1, "batchId is required").max(120) });

/**
 * { batchId }: stops a running audit. The question in progress finishes; the rest is recorded as
 * "stopped" and stays unanswered for a later audit. 404 when that audit is not running here.
 */
export const POST = route("crawl/stop", async (request: Request) => {
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  if (!CrawlerOrchestrator.requestStop(parsed.data.batchId)) return jsonError("That audit is not running on this server.", 404);
  return NextResponse.json({ success: true, status: "stopping" });
});
