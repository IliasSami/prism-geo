import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { getRawDb } from "@prismgeo/db";
import { jsonError, parseBody, route } from "../_lib/http";
import { resolveBrand } from "../_lib/brand";
import { LIMITS, brandIdSchema, domainSchema, idSchema, nameSchema, stringListSchema } from "../_lib/validate";

export const dynamic = "force-dynamic";

const aliasesSchema = stringListSchema(LIMITS.aliases, LIMITS.alias);

const createSchema = z.object({
  brandId: brandIdSchema,
  name: nameSchema("competitor name"),
  domain: domainSchema,
  aliases: aliasesSchema.optional(),
});

const patchSchema = z.object({
  brandId: brandIdSchema,
  id: idSchema("Competitor id"),
  name: nameSchema("competitor name").optional(),
  domain: domainSchema.optional(),
  aliases: aliasesSchema.optional(),
});

const deleteSchema = z.object({ brandId: brandIdSchema, id: idSchema("Competitor id") });

const tracked = (brandId: string, domain: string, exceptId?: string) =>
  Boolean(getRawDb().prepare("SELECT 1 FROM competitors WHERE brand_id = ? AND lower(domain) = ? AND id IS NOT ?").get(brandId, domain, exceptId ?? null));

/** Competitors tracked for ?brandId= or this browser's client. */
export const GET = route("competitors GET", async (request: Request) => {
  const resolved = resolveBrand(request, new URL(request.url).searchParams.get("brandId"));
  if (!resolved.ok) return resolved.response.status === 400 ? NextResponse.json({ competitors: [] }) : resolved.response;
  const rows = getRawDb()
    .prepare("SELECT id, name, domain, aliases_json FROM competitors WHERE brand_id = ? ORDER BY created_at")
    .all(resolved.brand.id) as Array<{ id: string; name: string; domain: string; aliases_json: string }>;
  const parseAliases = (json: string): string[] => {
    try {
      const list = JSON.parse(json || "[]");
      return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string") : [];
    } catch {
      return [];
    }
  };
  return NextResponse.json({
    brandId: resolved.brand.id,
    competitors: rows.map((r) => ({ id: r.id, name: r.name, domain: r.domain, aliases: parseAliases(r.aliases_json) })),
  });
});

/** Adds a competitor. Mentions are detected from the next crawl on. */
export const POST = route("competitors POST", async (request: Request) => {
  const parsed = await parseBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  const { brand } = resolved;
  const { name, domain, aliases } = parsed.data;
  if (domain === brand.domain) return jsonError(`${domain} is ${brand.name}'s own domain, not a competitor`, 400);
  if (tracked(brand.id, domain)) return jsonError(`${domain} is already tracked`, 409);
  const id = `cmp-${crypto.randomBytes(6).toString("hex")}`;
  getRawDb()
    .prepare("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES (?, ?, ?, ?, ?)")
    .run(id, brand.id, name, domain, JSON.stringify(aliases ?? []));
  return NextResponse.json({ success: true, id });
});

/** Updates a competitor; only the fields that are sent change (omitting aliases keeps them). */
export const PATCH = route("competitors PATCH", async (request: Request) => {
  const parsed = await parseBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  const { brand } = resolved;
  const { id, name, domain, aliases } = parsed.data;
  const sqlite = getRawDb();
  if (!sqlite.prepare("SELECT 1 FROM competitors WHERE id = ? AND brand_id = ?").get(id, brand.id)) {
    return jsonError("That competitor is not tracked for this client (reload the page)", 404);
  }
  if (domain !== undefined) {
    if (domain === brand.domain) return jsonError(`${domain} is ${brand.name}'s own domain, not a competitor`, 400);
    if (tracked(brand.id, domain, id)) return jsonError(`${domain} is already tracked`, 409);
  }
  const sets: string[] = [];
  const values: string[] = [];
  if (name !== undefined) {
    sets.push("name = ?");
    values.push(name);
  }
  if (domain !== undefined) {
    sets.push("domain = ?");
    values.push(domain);
  }
  if (aliases !== undefined) {
    sets.push("aliases_json = ?");
    values.push(JSON.stringify(aliases));
  }
  if (sets.length === 0) return jsonError("Nothing to update: send name, domain or aliases", 400);
  sqlite.prepare(`UPDATE competitors SET ${sets.join(", ")} WHERE id = ? AND brand_id = ?`).run(...values, id, brand.id);
  return NextResponse.json({ success: true });
});

/** Stops tracking a competitor. Past mentions stay in stored answers. */
export const DELETE = route("competitors DELETE", async (request: Request) => {
  const parsed = await parseBody(request, deleteSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  const res = getRawDb().prepare("DELETE FROM competitors WHERE id = ? AND brand_id = ?").run(parsed.data.id, resolved.brand.id);
  return res.changes ? NextResponse.json({ success: true }) : jsonError("That competitor is not tracked for this client (reload the page)", 404);
});
