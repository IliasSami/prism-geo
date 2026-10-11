import { NextResponse } from "next/server";
import { getRawDb, setActiveBrand } from "@prismgeo/db";
import { IcpPromptSynthesizer } from "@prismgeo/core";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sqlite = getRawDb();
  let inTransaction = false;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }

    const { brand, competitors, prompts, byok, engines } = body;

    if (!brand || typeof brand !== "object" || !brand.name || typeof brand.name !== "string" || !brand.name.trim()) {
      return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
    }
    if (!brand.domain || typeof brand.domain !== "string" || !brand.domain.trim()) {
      return NextResponse.json({ error: "Brand domain is required" }, { status: 400 });
    }

    const cleanName = brand.name.trim();
    const cleanDomain = brand.domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "");

    if (!cleanDomain || !cleanDomain.includes(".")) {
      return NextResponse.json({ error: "Valid domain name is required (e.g., example.com)" }, { status: 400 });
    }

    const brandId = `brand-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const cleanAliases = Array.isArray(brand.aliases)
      ? brand.aliases.filter((a: any) => typeof a === "string" && a.trim()).map((a: string) => a.trim())
      : [];
    const cleanValueProps = Array.isArray(brand.valueProps)
      ? brand.valueProps.filter((v: any) => typeof v === "string" && v.trim()).map((v: string) => v.trim())
      : [];

    const aliasesJson = JSON.stringify(cleanAliases);
    const valuePropsJson = JSON.stringify(cleanValueProps);
    const now = new Date().toISOString();

    // Check duplicate domain
    const existing = sqlite.prepare("SELECT id FROM brands WHERE domain = ? LIMIT 1").get(cleanDomain);
    if (existing) {
      return NextResponse.json(
        { error: `Brand with domain "${cleanDomain}" already exists` },
        { status: 409 }
      );
    }

    // Begin Atomic SQLite Transaction
    sqlite.exec("BEGIN TRANSACTION;");
    inTransaction = true;

    // 1. Insert Brand
    sqlite
      .prepare(
        `INSERT INTO brands (id, slug, name, domain, description, aliases_json, value_props_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(brandId, slug, cleanName, cleanDomain, brand.description?.trim() || "", aliasesJson, valuePropsJson, now, now);

    // 2. Insert Competitors
    const validCompetitors: Array<{ name: string; domain: string }> = [];
    if (Array.isArray(competitors)) {
      const insertComp = sqlite.prepare(
        `INSERT INTO competitors (id, brand_id, name, domain, aliases_json, active, created_at)
         VALUES (?, ?, ?, ?, '[]', 1, ?)`
      );
      for (const comp of competitors) {
        if (comp && typeof comp === "object" && typeof comp.name === "string" && comp.name.trim() && typeof comp.domain === "string" && comp.domain.trim()) {
          const compName = comp.name.trim();
          const compDomain = comp.domain
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .replace(/\/.*$/, "");
          const compId = `comp-${Math.random().toString(36).slice(2, 9)}`;
          insertComp.run(compId, brandId, compName, compDomain, now);
          validCompetitors.push({ name: compName, domain: compDomain });
        }
      }
    }

    // 3. Insert Prompts (Use IcpPromptSynthesizer if none supplied)
    let promptList: Array<{ queryText: string; intentType: string; personaDimension: string }> = [];
    if (Array.isArray(prompts) && prompts.length > 0) {
      promptList = prompts
        .filter((p: any) => p && (p.query || p.queryText))
        .map((p: any) => ({
          queryText: String(p.query || p.queryText).trim(),
          intentType: String(p.intent || p.intentType || "category"),
          personaDimension: String(p.persona || p.personaDimension || "buyer"),
        }));
    } else {
      const synthesized = IcpPromptSynthesizer.generatePrompts({
        brandName: cleanName,
        domain: cleanDomain,
        niche: brand.description?.trim() || "White-label SEO and AI visibility",
        aliases: cleanAliases,
        competitors: validCompetitors,
        valuePropositions: cleanValueProps,
      });
      promptList = synthesized.map((s) => ({
        queryText: s.queryText,
        intentType: s.intentType,
        personaDimension: s.personaDimension,
      }));
    }

    const insertPrompt = sqlite.prepare(
      `INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );

    for (const p of promptList) {
      const promptId = `prompt-${Math.random().toString(36).slice(2, 9)}`;
      insertPrompt.run(promptId, brandId, p.queryText, p.intentType, p.personaDimension, now);
    }

    // 4. Update BYOK Settings if provided
    if (byok && typeof byok === "object") {
      const existingByok = JSON.parse(
        (sqlite.prepare("SELECT value_json FROM system_settings WHERE key = 'byok_api_keys'").get() as any)?.value_json || "{}"
      );
      const mergedByok = { ...existingByok, ...byok };
      sqlite
        .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('byok_api_keys', ?, CURRENT_TIMESTAMP)")
        .run(JSON.stringify(mergedByok));
    }

    // 5. Update Engine Settings if provided
    if (engines && typeof engines === "object") {
      sqlite
        .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('engine_settings', ?, CURRENT_TIMESTAMP)")
        .run(JSON.stringify(engines));
    }

    // 6. Set Active Brand
    setActiveBrand(brandId);

    // Commit Transaction
    sqlite.exec("COMMIT;");
    inTransaction = false;

    const response = NextResponse.json({
      success: true,
      brandId,
      message: `Brand ${cleanName} created and activated successfully`,
      promptsCount: promptList.length,
    });

    response.cookies.set("prism_active_brand", brandId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error) {
    if (inTransaction) {
      try {
        sqlite.exec("ROLLBACK;");
      } catch {}
    }
    const msg = (error as Error).message || "Internal server error";
    const status = msg.includes("UNIQUE constraint failed") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
