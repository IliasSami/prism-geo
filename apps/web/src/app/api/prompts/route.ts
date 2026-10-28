import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getActiveBrand, getRawDb } from "@prismgeo/db";

export const dynamic = "force-dynamic";

/** Adds prompts (one per entry) to the active brand; exact duplicates are skipped. */
export async function POST(request: Request) {
  const brand = getActiveBrand();
  if (!brand) return NextResponse.json({ error: "No active brand" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const texts: string[] = (Array.isArray(body.prompts) ? body.prompts : [])
    .map((t: unknown) => String(t ?? "").trim())
    .filter((t: string) => t.length >= 5 && t.length <= 500);
  if (texts.length === 0) return NextResponse.json({ error: "Enter at least one prompt (5–500 characters)" }, { status: 400 });
  const intent = String(body.intent || "category").trim().slice(0, 40) || "category";
  const persona = String(body.persona || "buyer").trim().slice(0, 40) || "buyer";

  const sqlite = getRawDb();
  const existing = new Set(
    (sqlite.prepare("SELECT lower(query_text) AS q FROM prompts WHERE brand_id = ?").all(brand.id) as Array<{ q: string }>).map((r) => r.q)
  );
  const insert = sqlite.prepare(
    "INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active) VALUES (?, ?, ?, ?, ?, 1)"
  );
  let added = 0;
  for (const text of texts) {
    if (existing.has(text.toLowerCase())) continue;
    insert.run(`prm-${crypto.randomBytes(6).toString("hex")}`, brand.id, text, intent, persona);
    existing.add(text.toLowerCase());
    added++;
  }
  return NextResponse.json({ success: true, added, skipped: texts.length - added });
}

/**
 * Updates a prompt of the active brand: pause/resume ({ id, active }) and/or edit its wording or
 * intent ({ id, queryText, intentType }). Stored answers belong to the exact question that was
 * asked, so the wording of a prompt that already has answers cannot change; add a new prompt and
 * pause the old one instead.
 */
export async function PATCH(request: Request) {
  const brand = getActiveBrand();
  const body = await request.json().catch(() => ({}));
  if (!brand || typeof body.id !== "string") return NextResponse.json({ error: "Expected { id }" }, { status: 400 });
  const sqlite = getRawDb();
  const current = sqlite.prepare("SELECT * FROM prompts WHERE id = ? AND brand_id = ?").get(body.id, brand.id) as any;
  if (!current) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  const active = typeof body.active === "boolean" ? (body.active ? 1 : 0) : current.active;
  let queryText = current.query_text as string;
  if (typeof body.queryText === "string" && body.queryText.trim() !== queryText) {
    const text = body.queryText.trim();
    if (text.length < 5 || text.length > 500) return NextResponse.json({ error: "Prompts must be 5–500 characters" }, { status: 400 });
    const runs = (sqlite.prepare("SELECT COUNT(*) AS n FROM prompt_runs WHERE prompt_id = ?").get(body.id) as { n: number }).n;
    if (runs > 0) {
      return NextResponse.json(
        { error: `This prompt already has ${runs} captured answer(s) for its current wording. Add the new wording as a new prompt and pause this one.` },
        { status: 409 }
      );
    }
    if (sqlite.prepare("SELECT 1 FROM prompts WHERE brand_id = ? AND lower(query_text) = lower(?) AND id <> ?").get(brand.id, text, body.id)) {
      return NextResponse.json({ error: "That prompt is already tracked" }, { status: 409 });
    }
    queryText = text;
  }
  const intentType = typeof body.intentType === "string" && body.intentType.trim() ? body.intentType.trim().slice(0, 40) : current.intent_type;

  sqlite.prepare("UPDATE prompts SET active = ?, query_text = ?, intent_type = ? WHERE id = ?").run(active, queryText, intentType, body.id);
  return NextResponse.json({ success: true });
}

/** Deletes a prompt and, through cascades, every answer captured for it. */
export async function DELETE(request: Request) {
  const brand = getActiveBrand();
  const body = await request.json().catch(() => ({}));
  if (!brand || typeof body.id !== "string") return NextResponse.json({ error: "Expected { id }" }, { status: 400 });
  const res = getRawDb().prepare("DELETE FROM prompts WHERE id = ? AND brand_id = ?").run(body.id, brand.id);
  return res.changes ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Prompt not found" }, { status: 404 });
}
