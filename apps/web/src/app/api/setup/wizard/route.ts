import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { getRawDb, getSettings, setActiveBrand } from "@prismgeo/db";
import { IcpPromptSynthesizer } from "@prismgeo/core";
import { jsonError, parseBody, route } from "../../_lib/http";
import { setActiveBrandCookie } from "../../_lib/brand";
import {
  LIMITS,
  byokSchema,
  categorySchema,
  competitorSchema,
  dedupePrompts,
  domainSchema,
  engineSettingsSchema,
  intSchema,
  nameSchema,
  promptListSchema,
  stringListSchema,
  type PromptInput,
} from "../../_lib/validate";

export const dynamic = "force-dynamic";

const wizardSchema = z.object({
  brand: z.object(
    {
      name: nameSchema("brand name"),
      domain: domainSchema,
      description: z
        .string({ error: "The description must be text" })
        .trim()
        .max(LIMITS.description, `The description can be at most ${LIMITS.description} characters`)
        .optional(),
      category: categorySchema.optional(),
      aliases: stringListSchema(LIMITS.aliases, LIMITS.alias).optional(),
      valueProps: stringListSchema(LIMITS.valueProps, LIMITS.valueProp, "\n").optional(),
    },
    { error: "brand must be an object with a name and a domain" },
  ),
  competitors: z.array(competitorSchema).max(LIMITS.competitors, `At most ${LIMITS.competitors} competitors`).optional(),
  prompts: promptListSchema.optional(),
  promptLimit: intSchema(1, LIMITS.prompts, "The number of questions").optional(),
  byok: byokSchema.optional(),
  engines: engineSettingsSchema.optional(),
  crawler: z.object({ sampleSize: intSchema(1, 20, "Runs per question").optional() }).optional(),
});

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";

/**
 * Creates a client with its competitors and questions in one transaction, saves the optional
 * keys, engine and audit settings, and selects the client for this browser.
 *
 * Prompts may be strings or { query, intent?, persona? } objects. Any invalid input (a bad
 * competitor domain, a 3-character question) refuses the whole request with the field that is
 * wrong; nothing is dropped silently. Duplicate questions are skipped and listed in the response.
 */
export const POST = route("setup/wizard", async (request: Request) => {
  const parsed = await parseBody(request, wizardSchema);
  if (!parsed.ok) return parsed.response;
  const { brand, competitors = [], prompts, promptLimit, byok, engines, crawler } = parsed.data;
  const sqlite = getRawDb();

  if (sqlite.prepare("SELECT 1 FROM brands WHERE domain = ?").get(brand.domain)) {
    return jsonError(`A client with the domain ${brand.domain} already exists. Switch to it in the client menu.`, 409);
  }
  const seenDomains = new Set<string>();
  for (const [i, c] of competitors.entries()) {
    if (c.domain === brand.domain) return jsonError(`competitors.${i}.domain: ${c.domain} is the brand's own domain`, 400);
    if (seenDomains.has(c.domain)) return jsonError(`competitors.${i}.domain: ${c.domain} is listed twice`, 400);
    seenDomains.add(c.domain);
  }

  // The questions: the caller's own, or written from the brand profile
  let promptList: PromptInput[];
  let duplicates: string[] = [];
  if (prompts) {
    ({ unique: promptList, duplicates } = dedupePrompts(prompts));
  } else {
    const niche = brand.description || brand.category || "";
    if (!niche) {
      return jsonError("Describe what the brand does (or give its category) so PrismGEO can write the questions, or add your own questions.", 400);
    }
    promptList = IcpPromptSynthesizer.generatePrompts({
      brandName: brand.name,
      domain: brand.domain,
      niche,
      category: brand.category,
      aliases: brand.aliases ?? [],
      competitors: competitors.map((c) => ({ name: c.name, domain: c.domain })),
      valuePropositions: brand.valueProps ?? [],
    }).map((s) => ({ queryText: s.queryText, intentType: s.intentType, personaDimension: s.personaDimension }));
    if (promptLimit) promptList = promptList.slice(0, promptLimit);
  }

  const brandId = `brand-${slugify(brand.name).slice(0, 40)}-${crypto.randomBytes(3).toString("hex")}`;
  const slug = `${slugify(brand.name).slice(0, 60)}-${crypto.randomBytes(3).toString("hex")}`;
  const now = new Date().toISOString();
  const hasCategoryColumn = (sqlite.prepare("PRAGMA table_info(brands)").all() as Array<{ name: string }>).some((c) => c.name === "category");
  const notStored = brand.category && !hasCategoryColumn ? ["brand.category"] : [];

  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite
      .prepare(
        `INSERT INTO brands (id, slug, name, domain, description, aliases_json, value_props_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(brandId, slug, brand.name, brand.domain, brand.description ?? "", JSON.stringify(brand.aliases ?? []), JSON.stringify(brand.valueProps ?? []), now, now);
    if (brand.category && hasCategoryColumn) sqlite.prepare("UPDATE brands SET category = ? WHERE id = ?").run(brand.category, brandId);

    const insertCompetitor = sqlite.prepare(
      "INSERT INTO competitors (id, brand_id, name, domain, aliases_json, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    );
    for (const c of competitors) {
      insertCompetitor.run(`cmp-${crypto.randomBytes(6).toString("hex")}`, brandId, c.name, c.domain, JSON.stringify(c.aliases ?? []), now);
    }

    const insertPrompt = sqlite.prepare(
      "INSERT INTO prompts (id, brand_id, query_text, intent_type, persona_dimension, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    );
    for (const p of promptList) {
      insertPrompt.run(`prm-${crypto.randomBytes(6).toString("hex")}`, brandId, p.queryText, p.intentType ?? "category", p.personaDimension ?? "buyer", now);
    }

    const save = sqlite.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)");
    if (byok) {
      const keys = { ...getSettings<Record<string, string>>("byok_api_keys", {}) };
      for (const [provider, value] of Object.entries(byok)) {
        // Only new keys are saved here; clearing keys is done in Settings
        if (typeof value === "string" && value.trim() && !value.includes("••••")) keys[provider] = value.trim();
      }
      save.run("byok_api_keys", JSON.stringify(keys));
    }
    if (engines) {
      save.run("engine_settings", JSON.stringify({ ...getSettings<Record<string, unknown>>("engine_settings", {}), ...engines }));
    }
    if (crawler?.sampleSize !== undefined) {
      save.run("crawler_settings", JSON.stringify({ ...getSettings<Record<string, unknown>>("crawler_settings", {}), sampleSize: crawler.sampleSize }));
    }
    setActiveBrand(brandId);
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }

  const response = NextResponse.json({
    success: true,
    brandId,
    message: `${brand.name} created`,
    promptsCount: promptList.length,
    competitorsCount: competitors.length,
    duplicates,
    ...(notStored.length ? { notStored } : {}),
  });
  setActiveBrandCookie(response, brandId, request);
  return response;
});
