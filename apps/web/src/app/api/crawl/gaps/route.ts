import { NextResponse } from "next/server";
import { unansweredPromptIdsByEngine } from "@prismgeo/crawler";
import { route } from "../../_lib/http";
import { resolveBrand } from "../../_lib/brand";
import { ENGINE_IDS } from "../../_lib/validate";

export const dynamic = "force-dynamic";

/**
 * GET ?brandId=: per engine, how many active questions it has never answered. The audit dialog's
 * "Unanswered" choice counts its answers from this instead of from every question.
 */
export const GET = route("crawl/gaps", async (request: Request) => {
  const brandId = new URL(request.url).searchParams.get("brandId") || undefined;
  const resolved = resolveBrand(request, brandId);
  if (!resolved.ok) return resolved.response;
  const gaps = unansweredPromptIdsByEngine(resolved.brand.id, [...ENGINE_IDS]);
  return NextResponse.json({ brandId: resolved.brand.id, gaps: Object.fromEntries(ENGINE_IDS.map((e) => [e, gaps[e]?.length ?? 0])) });
});
