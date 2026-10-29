import { NextResponse } from "next/server";
import { z } from "zod";
import { CaptureRejectedError, CrawlerOrchestrator, MANUAL_ENGINES } from "@prismgeo/crawler";
import { jsonError, parseBody, route } from "../_lib/http";
import { requireCaptureToken } from "../_lib/capture-auth";

export const dynamic = "force-dynamic";

const captureSchema = z.strictObject({
  brandId: z.string().trim().min(1).max(100),
  engine: z.enum(MANUAL_ENGINES, { error: `engine must be one of ${MANUAL_ENGINES.join(", ")}` }),
  promptId: z.string().trim().min(1).max(100).optional(),
  question: z.string().trim().max(500, "The question is too long").optional(),
  addAsPrompt: z.boolean().optional(),
  intent: z.string().trim().max(40).optional(),
  answerText: z.string().min(1, "The answer is empty").max(60_000, "The answer is too long"),
  citations: z
    .array(z.strictObject({ url: z.string().max(2_000), title: z.string().max(500).optional() }))
    .max(200)
    .default([]),
  pageUrl: z.string().max(2_000).optional(),
});

/**
 * Saves one answer captured by hand with the PrismGEO extension (token-authenticated). The answer
 * is checked and stored like a crawled one, with capture_method 'manual'.
 */
export const POST = route("capture", async (request: Request) => {
  const denied = requireCaptureToken(request);
  if (denied) return denied;
  const parsed = await parseBody(request, captureSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await CrawlerOrchestrator.storeManualCapture(parsed.data);
    console.log(`[Capture] ${parsed.data.engine} answer saved for "${result.promptText.slice(0, 60)}" (${result.mentions.length} tracked companies)`);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof CaptureRejectedError) return jsonError(err.message, err.status);
    throw err;
  }
});
