import { NextResponse } from "next/server";
import { getRawDb } from "@prismgeo/db";
import { discoverCompanies } from "@prismgeo/core";
import { trackedEntitiesFor } from "@prismgeo/crawler";
import { route } from "../../_lib/http";
import { resolveBrand } from "../../_lib/brand";

export const dynamic = "force-dynamic";

/**
 * Companies the engines name in this client's answers that are not tracked (?brandId=), with how
 * many answers and questions name them and their cited site when one was cited. Suggestions only;
 * nothing is tracked until the user adds it.
 */
export const GET = route("competitor suggestions", async (request: Request) => {
  const resolved = resolveBrand(request, new URL(request.url).searchParams.get("brandId"));
  if (!resolved.ok) return resolved.response;
  const { brand } = resolved;
  const sqlite = getRawDb();
  const answers = sqlite
    .prepare("SELECT response_text AS text, engine, prompt_id AS promptId FROM prompt_runs WHERE brand_id = ? ORDER BY created_at DESC LIMIT 3000")
    .all(brand.id) as Array<{ text: string; engine: string; promptId: string }>;
  // Paused competitors count as known: suggesting them again would be noise
  const paused = sqlite.prepare("SELECT name FROM competitors WHERE brand_id = ? AND active = 0").all(brand.id) as Array<{ name: string }>;
  const { entities } = trackedEntitiesFor(brand);
  const tracked = [...entities.map((e) => e.terms), ...paused.map((p) => [p.name.toLowerCase()])];
  const citedDomains = (sqlite.prepare("SELECT DISTINCT domain FROM citations WHERE brand_id = ?").all(brand.id) as Array<{ domain: string }>).map((r) => r.domain);
  const suggestions = discoverCompanies(answers, tracked, { citedDomains, limit: 15 });
  return NextResponse.json({ brandId: brand.id, answers: answers.length, suggestions });
});
