import { NextResponse } from "next/server";
import { getRawDb, setActiveBrand } from "@prismgeo/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { brand, competitors, prompts, byok, engines } = body;

    if (!brand || !brand.name || !brand.domain) {
      return NextResponse.json({ error: "Brand name and domain are required" }, { status: 400 });
    }

    const sqlite = getRawDb();
    const brandId = `brand-${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
    const slug = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const aliasesJson = JSON.stringify(brand.aliases || []);
    const valuePropsJson = JSON.stringify(brand.valueProps || []);
    const now = new Date().toISOString();

    // 1. Insert Brand
    sqlite
      .prepare(
        `INSERT INTO brands (id, slug, name, domain, description, aliases_json, value_props_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(brandId, slug, brand.name, brand.domain, brand.description || "", aliasesJson, valuePropsJson, now, now);

    // 2. Insert Competitors
    if (Array.isArray(competitors)) {
      const insertComp = sqlite.prepare(
        `INSERT INTO competitors (id, brand_id, name, domain, aliases_json, active, created_at)
         VALUES (?, ?, ?, ?, '[]', 1, ?)`
      );
      for (const comp of competitors) {
        if (comp.name && comp.domain) {
          const compId = `comp-${Math.random().toString(36).slice(2, 9)}`;
          insertComp.run(compId, brandId, comp.name, comp.domain, now);
        }
      }
    }

    // 3. Insert Prompts (Default calibrated prompts if none supplied)
    const promptList = Array.isArray(prompts) && prompts.length > 0
      ? prompts
      : [
          { query: `What is the best platform for ${brand.name}?`, intent: "category", persona: "agency_executive" },
          { query: `${brand.name} vs competitors pricing and features`, intent: "comparison", persona: "buyer" },
          { query: `Is ${brand.name} worth it for modern businesses?`, intent: "dilemma", persona: "buyer" },
          { query: `Top alternatives to ${competitors?.[0]?.name || "legacy tools"} in 2026`, intent: "comparison", persona: "agency_executive" },
          { query: `Best AI automated tools for ${brand.domain}`, intent: "direct", persona: "technical" },
        ];

    const insertPrompt = sqlite.prepare(
      `INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );

    for (const p of promptList) {
      const promptId = `prompt-${Math.random().toString(36).slice(2, 9)}`;
      insertPrompt.run(promptId, brandId, p.query || p.queryText, p.intent || p.intentType || "category", p.persona || p.personaDimension || "buyer", now);
    }

    // 4. Update BYOK Settings if provided
    if (byok) {
      const existingByok = JSON.parse(
        (sqlite.prepare("SELECT value_json FROM system_settings WHERE key = 'byok_api_keys'").get() as any)?.value_json || "{}"
      );
      const mergedByok = { ...existingByok, ...byok };
      sqlite
        .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('byok_api_keys', ?, CURRENT_TIMESTAMP)")
        .run(JSON.stringify(mergedByok));
    }

    // 5. Update Engine Settings if provided
    if (engines) {
      sqlite
        .prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('engine_settings', ?, CURRENT_TIMESTAMP)")
        .run(JSON.stringify(engines));
    }

    // 6. Set Active Brand
    setActiveBrand(brandId);

    const response = NextResponse.json({
      success: true,
      brandId,
      message: `Brand ${brand.name} created and activated successfully`,
    });
    response.cookies.set("prism_active_brand", brandId, { path: "/", sameSite: "lax" });
    return response;
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
