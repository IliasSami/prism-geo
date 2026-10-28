import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getActiveBrand, getRawDb } from "@prismgeo/db";

export const dynamic = "force-dynamic";

const cleanDomain = (d: string) => d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
const parseAliases = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((a) => String(a).trim())
    .filter((a) => a.length > 0)
    .slice(0, 20);

/** Competitors tracked for the active brand. */
export async function GET() {
  const brand = getActiveBrand();
  if (!brand) return NextResponse.json({ competitors: [] });
  const rows = getRawDb()
    .prepare("SELECT id, name, domain, aliases_json FROM competitors WHERE brand_id = ? ORDER BY created_at")
    .all(brand.id) as Array<{ id: string; name: string; domain: string; aliases_json: string }>;
  return NextResponse.json({ competitors: rows.map((r) => ({ id: r.id, name: r.name, domain: r.domain, aliases: JSON.parse(r.aliases_json || "[]") })) });
}

/** Adds a competitor. Mentions are detected from the next crawl on. */
export async function POST(request: Request) {
  const brand = getActiveBrand();
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const domain = cleanDomain(String(body.domain || ""));
  if (!brand || name.length < 2 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return NextResponse.json({ error: "Enter a name and a domain like example.com" }, { status: 400 });
  }
  const sqlite = getRawDb();
  if (sqlite.prepare("SELECT 1 FROM competitors WHERE brand_id = ? AND lower(domain) = ?").get(brand.id, domain)) {
    return NextResponse.json({ error: `${domain} is already tracked` }, { status: 409 });
  }
  const id = `cmp-${crypto.randomBytes(6).toString("hex")}`;
  sqlite
    .prepare("INSERT INTO competitors (id, brand_id, name, domain, aliases_json) VALUES (?, ?, ?, ?, ?)")
    .run(id, brand.id, name, domain, JSON.stringify(parseAliases(body.aliases)));
  return NextResponse.json({ success: true, id });
}

/** Updates a competitor's name, domain or aliases. */
export async function PATCH(request: Request) {
  const brand = getActiveBrand();
  const body = await request.json().catch(() => ({}));
  if (!brand || typeof body.id !== "string") return NextResponse.json({ error: "Expected { id }" }, { status: 400 });
  const name = String(body.name || "").trim();
  const domain = cleanDomain(String(body.domain || ""));
  if (name.length < 2 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return NextResponse.json({ error: "Enter a name and a domain like example.com" }, { status: 400 });
  }
  const res = getRawDb()
    .prepare("UPDATE competitors SET name = ?, domain = ?, aliases_json = ? WHERE id = ? AND brand_id = ?")
    .run(name, domain, JSON.stringify(parseAliases(body.aliases)), body.id, brand.id);
  return res.changes ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Competitor not found" }, { status: 404 });
}

/** Stops tracking a competitor. Past mentions stay in stored answers. */
export async function DELETE(request: Request) {
  const brand = getActiveBrand();
  const body = await request.json().catch(() => ({}));
  if (!brand || typeof body.id !== "string") return NextResponse.json({ error: "Expected { id }" }, { status: 400 });
  const res = getRawDb().prepare("DELETE FROM competitors WHERE id = ? AND brand_id = ?").run(body.id, brand.id);
  return res.changes ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Competitor not found" }, { status: 404 });
}
