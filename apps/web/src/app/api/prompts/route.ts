import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { getRawDb } from "@prismgeo/db";
import { closeStaleBatches } from "@prismgeo/crawler";
import { jsonError, parseBody, route } from "../_lib/http";
import { resolveBrand } from "../_lib/brand";
import { LIMITS, brandIdSchema, dedupePrompts, idSchema, intentSchema, personaSchema, promptListSchema } from "../_lib/validate";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  brandId: brandIdSchema,
  prompts: promptListSchema,
  intent: intentSchema.optional(),
  persona: personaSchema.optional(),
});

const patchSchema = z.object({
  brandId: brandIdSchema,
  id: idSchema("Prompt id"),
  active: z.boolean({ error: "active must be true or false" }).optional(),
  queryText: z
    .string({ error: "queryText must be text" })
    .trim()
    .min(LIMITS.promptMin, `Prompts need at least ${LIMITS.promptMin} characters`)
    .max(LIMITS.promptMax, `Prompts can be at most ${LIMITS.promptMax} characters`)
    .optional(),
  intentType: intentSchema.optional(),
  personaDimension: personaSchema.optional(),
});

const deleteSchema = z.object({ brandId: brandIdSchema, id: idSchema("Prompt id") });

/**
 * Adds prompts to a client: { prompts: [string | {query, intent?, persona?}], intent?, persona?, brandId? }.
 * Every entry is validated (5–500 characters); one invalid entry refuses the whole request with
 * its position, so nothing is dropped silently. Duplicates (case-insensitive) are reported.
 */
export const POST = route("prompts POST", async (request: Request) => {
  const parsed = await parseBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  const { brand } = resolved;
  const sqlite = getRawDb();
  const existing = (sqlite.prepare("SELECT query_text AS q FROM prompts WHERE brand_id = ?").all(brand.id) as Array<{ q: string }>).map((r) => r.q);
  const { unique, duplicates } = dedupePrompts(parsed.data.prompts, existing);

  const insert = sqlite.prepare("INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active) VALUES (?, ?, ?, ?, ?, 1)");
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const p of unique) {
      insert.run(`prm-${crypto.randomBytes(6).toString("hex")}`, brand.id, p.queryText, p.intentType ?? parsed.data.intent ?? "category", p.personaDimension ?? parsed.data.persona ?? "buyer");
    }
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  return NextResponse.json({ success: true, brandId: brand.id, added: unique.length, skipped: duplicates.length, duplicates });
});

/**
 * Updates a prompt: pause/resume ({ id, active }) and/or edit its wording, intent or persona.
 * Stored answers belong to the exact question that was asked, so the wording of a prompt that
 * already has answers cannot change; add a new prompt and pause the old one instead.
 */
export const PATCH = route("prompts PATCH", async (request: Request) => {
  const parsed = await parseBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  const { brand } = resolved;
  const { id, active, queryText, intentType, personaDimension } = parsed.data;
  if (active === undefined && queryText === undefined && intentType === undefined && personaDimension === undefined) {
    return jsonError("Nothing to update: send active, queryText, intentType or personaDimension", 400);
  }
  const sqlite = getRawDb();
  const current = sqlite.prepare("SELECT query_text FROM prompts WHERE id = ? AND brand_id = ?").get(id, brand.id) as { query_text: string } | undefined;
  if (!current) return jsonError("That prompt does not exist for this client (reload the page)", 404);

  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (queryText !== undefined && queryText !== current.query_text) {
    const runs = (sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE prompt_id = ?").get(id) as { n: number }).n;
    if (runs > 0) {
      return jsonError(
        `This prompt already has ${runs} captured answer(s) for its current wording. Add the new wording as a new prompt and pause this one.`,
        409,
      );
    }
    if (sqlite.prepare("SELECT 1 FROM prompts WHERE brand_id = ? AND lower(query_text) = lower(?) AND id <> ?").get(brand.id, queryText, id)) {
      return jsonError("That prompt is already tracked", 409);
    }
    sets.push("query_text = ?");
    values.push(queryText);
  }
  if (active !== undefined) {
    sets.push("active = ?");
    values.push(active ? 1 : 0);
  }
  if (intentType !== undefined) {
    sets.push("intent_type = ?");
    values.push(intentType);
  }
  if (personaDimension !== undefined) {
    sets.push("persona_dimension = ?");
    values.push(personaDimension);
  }
  if (sets.length) sqlite.prepare(`UPDATE prompts SET ${sets.join(", ")} WHERE id = ? AND brand_id = ?`).run(...values, id, brand.id);
  return NextResponse.json({ success: true });
});

/**
 * Deletes a prompt and, through cascades, every answer captured for it. Refused while an audit
 * runs for the client: the running audit would still ask it and could not save the answers.
 */
export const DELETE = route("prompts DELETE", async (request: Request) => {
  const parsed = await parseBody(request, deleteSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  closeStaleBatches();
  if (getRawDb().prepare("SELECT 1 FROM crawl_batches WHERE brand_id = ? AND status = 'running'").get(resolved.brand.id)) {
    return jsonError("An audit is running for this client. Pause the prompt now, or delete it once the audit has finished.", 409);
  }
  const res = getRawDb().prepare("DELETE FROM prompts WHERE id = ? AND brand_id = ?").run(parsed.data.id, resolved.brand.id);
  return res.changes ? NextResponse.json({ success: true }) : jsonError("That prompt does not exist for this client (reload the page)", 404);
});
