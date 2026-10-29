import { NextResponse } from "next/server";
import { getActiveBrand, getAllBrands, getRawDb } from "@prismgeo/db";
import { route } from "../../_lib/http";
import { requireCaptureToken } from "../../_lib/capture-auth";

export const dynamic = "force-dynamic";

/**
 * What the capture extension needs to file an answer: the clients and, for the chosen one
 * (?brandId=, default the active client), its tracked questions. Token-authenticated.
 */
export const GET = route("capture context", async (request: Request) => {
  const denied = requireCaptureToken(request);
  if (denied) return denied;
  const brands = getAllBrands().map((b) => ({ id: b.id, name: b.name, domain: b.domain }));
  const wanted = new URL(request.url).searchParams.get("brandId");
  const brand = brands.find((b) => b.id === wanted) || brands.find((b) => b.id === getActiveBrand()?.id) || brands[0];
  const prompts = brand
    ? (getRawDb()
        .prepare("SELECT id, query_text AS text, intent_type AS intent, active FROM prompts WHERE brand_id = ? ORDER BY active DESC, created_at")
        .all(brand.id) as Array<{ id: string; text: string; intent: string; active: number }>).map((p) => ({ ...p, active: p.active === 1 }))
    : [];
  return NextResponse.json({ app: "PrismGEO", brands, brandId: brand?.id ?? null, prompts });
});
