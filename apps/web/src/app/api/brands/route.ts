import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllBrands, getActiveBrand, createBrand, setActiveBrand, getRawDb } from "@prismgeo/db";
import { closeStaleBatches } from "@prismgeo/crawler";
import { jsonError, parseBody, route } from "../_lib/http";
import { brandFromRequest, findBrand, setActiveBrandCookie } from "../_lib/brand";
import { LIMITS, categorySchema, domainSchema, idSchema, nameSchema, stringListSchema } from "../_lib/validate";

export const dynamic = "force-dynamic";

const descriptionSchema = z
  .string({ error: "The description must be text" })
  .trim()
  .max(LIMITS.description, `The description can be at most ${LIMITS.description} characters`);

const createSchema = z.object({
  name: nameSchema("brand name"),
  domain: domainSchema,
  description: descriptionSchema.optional(),
  aliases: stringListSchema(LIMITS.aliases, LIMITS.alias).optional(),
  valueProps: stringListSchema(LIMITS.valueProps, LIMITS.valueProp, "\n").optional(),
  category: categorySchema.optional(),
  setActive: z.boolean().optional(),
});

const patchSchema = z.object({
  id: idSchema("Client id"),
  name: nameSchema("brand name").optional(),
  domain: domainSchema.optional(),
  description: z.union([descriptionSchema, z.null()]).optional(),
  aliases: stringListSchema(LIMITS.aliases, LIMITS.alias).optional(),
  valueProps: stringListSchema(LIMITS.valueProps, LIMITS.valueProp, "\n").optional(),
  category: z.union([categorySchema, z.null()]).optional(),
});

const deleteSchema = z.object({ id: idSchema("Client id") });

/** Whether the brands table has a column (a category column may be added by a later migration). */
function brandsHaveColumn(name: string): boolean {
  return (getRawDb().prepare("PRAGMA table_info(brands)").all() as Array<{ name: string }>).some((c) => c.name === name);
}

function domainTaken(domain: string, exceptId?: string): boolean {
  return Boolean(getRawDb().prepare("SELECT 1 FROM brands WHERE domain = ? AND id IS NOT ?").get(domain, exceptId ?? null));
}

/** Every client, plus the one this browser has selected. */
export const GET = route("brands GET", async (request: Request) => {
  const brands = getAllBrands();
  const activeBrand = brandFromRequest(request) ?? brands[0] ?? null;
  return NextResponse.json({ brands, activeBrandId: activeBrand?.id ?? null, activeBrand });
});

/** Creates a client and, unless setActive is false, selects it for this browser. */
export const POST = route("brands POST", async (request: Request) => {
  const parsed = await parseBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const { name, domain, description, aliases, valueProps, category, setActive } = parsed.data;
  if (domainTaken(domain)) return jsonError(`A client with the domain ${domain} already exists`, 409);

  const brand = createBrand({ name, domain, description, aliases: aliases ?? [], valueProps: valueProps ?? [] });
  const notStored: string[] = [];
  if (category !== undefined) {
    if (brandsHaveColumn("category")) getRawDb().prepare("UPDATE brands SET category = ? WHERE id = ?").run(category, brand.id);
    else notStored.push("category");
  }

  const response = NextResponse.json({ success: true, brand: findBrand(brand.id) ?? brand, ...(notStored.length ? { notStored } : {}) });
  if (setActive !== false) {
    setActiveBrand(brand.id);
    setActiveBrandCookie(response, brand.id, request);
  }
  return response;
});

/** Updates a client's profile; only the fields that are sent change. */
export const PATCH = route("brands PATCH", async (request: Request) => {
  const parsed = await parseBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, domain, description, aliases, valueProps, category } = parsed.data;
  const current = findBrand(id);
  if (!current || current.id !== id) return jsonError("That client does not exist (it may have been deleted)", 404);
  if (domain && domainTaken(domain, id)) return jsonError(`Another client already uses the domain ${domain}`, 409);

  const sets: string[] = [];
  const values: Array<string | null> = [];
  const set = (column: string, value: string | null) => (sets.push(`${column} = ?`), values.push(value));
  if (name !== undefined) set("name", name);
  if (domain !== undefined) set("domain", domain);
  if (description !== undefined) set("description", description || null);
  if (aliases !== undefined) set("aliases_json", JSON.stringify(aliases));
  if (valueProps !== undefined) set("value_props_json", JSON.stringify(valueProps));
  const notStored: string[] = [];
  if (category !== undefined) {
    if (brandsHaveColumn("category")) set("category", category);
    else notStored.push("category");
  }
  if (sets.length === 0 && notStored.length === 0) return jsonError("Nothing to update: send name, domain, description, aliases or valueProps", 400);
  if (sets.length) {
    set("updated_at", new Date().toISOString());
    getRawDb()
      .prepare(`UPDATE brands SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values, id);
  }
  return NextResponse.json({ success: true, brand: findBrand(id), ...(notStored.length ? { notStored } : {}) });
});

/**
 * Deletes a client and, through cascades, its prompts, competitors, audits and answers.
 * The client selected in this browser (or server-wide) cannot be deleted; switch first.
 */
export const DELETE = route("brands DELETE", async (request: Request) => {
  const parsed = await parseBody(request, deleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;
  if (!findBrand(id)) return jsonError("That client does not exist (it may have been deleted)", 404);
  if (brandFromRequest(request)?.id === id || getActiveBrand()?.id === id) {
    return jsonError("Switch to another client before deleting this one", 409);
  }
  // A batch left 'running' by a stopped process must not block the delete
  closeStaleBatches();
  const sqlite = getRawDb();
  if (sqlite.prepare("SELECT 1 FROM crawl_batches WHERE brand_id = ? AND status = 'running'").get(id)) {
    return jsonError("An audit is running for this client. Wait for it to finish, then delete.", 409);
  }
  sqlite.prepare("DELETE FROM brands WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
});
