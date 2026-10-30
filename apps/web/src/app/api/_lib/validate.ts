import { z } from "zod";

/** Validation rules shared by the API routes, so the same input is accepted (or refused) everywhere. */

export { ENGINE_IDS } from "@prismgeo/core";
import { ENGINE_IDS } from "@prismgeo/core";
export type EngineId = (typeof ENGINE_IDS)[number];
export const ENGINE_MODES = ["stealth", "byok", "hybrid"] as const;
export const BYOK_PROVIDERS = ["openai", "gemini", "perplexity", "serpapi", "dataforseo", "apify"] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export const LIMITS = {
  name: 120,
  description: 2000,
  alias: 120,
  aliases: 20,
  valueProp: 300,
  valueProps: 20,
  competitors: 50,
  promptMin: 5,
  promptMax: 500,
  prompts: 200,
  label: 40,
  apiKey: 300,
  proxyUrl: 2000,
} as const;

const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * "https://www.Example.com:443/pricing?x" → "example.com". Returns null for anything that is not a
 * plain host name with a dot (spaces, IP-less garbage, a bare word).
 */
export function normalizeDomain(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  let host: string;
  try {
    host = new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return HOSTNAME.test(host) ? host : null;
}

const DOMAIN_MESSAGE = "Enter a domain like example.com";

export const domainSchema = z
  .string({ error: DOMAIN_MESSAGE })
  .max(253, DOMAIN_MESSAGE)
  .transform((value, ctx) => {
    const domain = normalizeDomain(value);
    if (!domain) {
      ctx.addIssue({ code: "custom", message: DOMAIN_MESSAGE });
      return z.NEVER;
    }
    return domain;
  });

export const nameSchema = (what: string) =>
  z
    .string({ error: `Enter the ${what}` })
    .trim()
    .min(2, `The ${what} needs at least 2 characters`)
    .max(LIMITS.name, `The ${what} can be at most ${LIMITS.name} characters`);

/** A list of short strings, given as an array or as comma-separated text; blanks and duplicates removed. */
export const stringListSchema = (max: number, maxLength: number, separator: "," | "\n" = ",") =>
  z
    .union([z.array(z.string({ error: "Each entry must be text" })), z.string()])
    .transform((value) => (typeof value === "string" ? value.split(separator) : value))
    .transform((list) => [...new Set(list.map((v) => v.trim()).filter(Boolean))])
    .pipe(
      z
        .array(z.string().max(maxLength, `Each entry can be at most ${maxLength} characters`))
        .max(max, `At most ${max} entries`),
    );

/** A whole number given as a number or a numeric string ("3"), within [min, max]. */
export const intSchema = (min: number, max: number, what: string) =>
  z
    .union([z.number(), z.string().trim().regex(/^-?\d+$/, `${what} must be a whole number`)])
    .transform(Number)
    .pipe(
      z
        .number()
        .int(`${what} must be a whole number`)
        .min(min, `${what} must be between ${min} and ${max}`)
        .max(max, `${what} must be between ${min} and ${max}`),
    );

export const idSchema = (what: string) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? `${what} is required` : `${what} must be text`) })
    .trim()
    .min(1, `${what} is required`)
    .max(200, `${what} is too long`);

/** Optional brand id: when present it must be a non-empty string. */
export const brandIdSchema = idSchema("brandId").optional();

const labelSchema = (what: string) =>
  z.string({ error: `${what} must be text` }).trim().min(1, `${what} cannot be empty`).max(LIMITS.label, `${what} can be at most ${LIMITS.label} characters`);

/** A buyer question as text. */
const promptTextSchema = z
  .string({ error: "Each prompt must be text" })
  .trim()
  .min(LIMITS.promptMin, `Prompts need at least ${LIMITS.promptMin} characters`)
  .max(LIMITS.promptMax, `Prompts can be at most ${LIMITS.promptMax} characters`);

export interface PromptInput {
  queryText: string;
  intentType?: string;
  personaDimension?: string;
}

/**
 * One prompt, as text ("best ai voice agent for shopify") or as an object
 * ({ query | queryText, intent | intentType, persona | personaDimension }).
 * The wizard and /api/prompts both accept either shape.
 */
const promptObjectSchema = z
  .object({
    query: promptTextSchema.optional(),
    queryText: promptTextSchema.optional(),
    intent: labelSchema("intent").optional(),
    intentType: labelSchema("intent").optional(),
    persona: labelSchema("persona").optional(),
    personaDimension: labelSchema("persona").optional(),
  })
  .refine((p) => p.query !== undefined || p.queryText !== undefined, "Each prompt needs a query")
  .transform(
    (p): PromptInput => ({
      queryText: (p.queryText ?? p.query) as string,
      intentType: p.intentType ?? p.intent,
      personaDimension: p.personaDimension ?? p.persona,
    }),
  );

/**
 * One prompt, as text ("best ai voice agent for shopify") or as an object
 * ({ query | queryText, intent | intentType, persona | personaDimension }).
 * The wizard and /api/prompts both accept either shape; anything else is refused.
 */
export const promptInputSchema = z.unknown().transform((value, ctx): PromptInput => {
  const result =
    typeof value === "string"
      ? promptTextSchema.transform((queryText): PromptInput => ({ queryText })).safeParse(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? promptObjectSchema.safeParse(value)
        : null;
  if (!result) {
    ctx.addIssue({ code: "custom", message: "Each prompt must be text or an object with a query" });
    return z.NEVER;
  }
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    return z.NEVER;
  }
  return result.data;
});

export const promptListSchema = z
  .array(promptInputSchema, { error: "prompts must be a list" })
  .min(1, "Add at least one prompt")
  .max(LIMITS.prompts, `At most ${LIMITS.prompts} prompts at a time`);

/** Case-insensitive dedupe that keeps the first spelling; returns the duplicates it dropped. */
export function dedupePrompts<T extends { queryText: string }>(list: T[], existing: Iterable<string> = []): { unique: T[]; duplicates: string[] } {
  const seen = new Set([...existing].map((q) => q.toLowerCase()));
  const unique: T[] = [];
  const duplicates: string[] = [];
  for (const p of list) {
    const key = p.queryText.toLowerCase();
    if (seen.has(key)) duplicates.push(p.queryText);
    else {
      seen.add(key);
      unique.push(p);
    }
  }
  return { unique, duplicates };
}

export const intentSchema = labelSchema("intent");
export const personaSchema = labelSchema("persona");

/**
 * A short category for the brand ("AI voice agents for e-commerce"): 2 to 8 words, used to write
 * buyer questions. Only accepted where the database can store it.
 */
export const categorySchema = z
  .string({ error: "The category must be text" })
  .trim()
  .max(80, "The category can be at most 80 characters")
  .refine((v) => {
    const words = v.split(/\s+/).filter(Boolean).length;
    return words >= 2 && words <= 8;
  }, "Describe the category in 2 to 8 words");

export const competitorSchema = z.object({
  name: nameSchema("competitor name"),
  domain: domainSchema,
  aliases: stringListSchema(LIMITS.aliases, LIMITS.alias).optional(),
});

export const engineSettingsSchema = z.strictObject({
  ...(Object.fromEntries(ENGINE_IDS.map((e) => [e, z.boolean({ error: `${e} must be true or false` }).optional()])) as Record<
    EngineId,
    z.ZodOptional<z.ZodBoolean>
  >),
  mode: z.enum(ENGINE_MODES, { error: `mode must be one of ${ENGINE_MODES.join(", ")}` }).optional(),
  /** Market a data provider (DataForSEO) asks from, as DataForSEO names it: "United States", "United Kingdom". */
  providerLocation: z
    .string({ error: "The location must be text" })
    .trim()
    .min(2, "Enter a country or city, e.g. United States")
    .max(80, "The location is too long")
    .regex(/^[\p{L} ,.'()-]+$/u, "Use a location name such as United States or London,England,United Kingdom")
    .optional(),
  /** Markets being measured ("United States, Europe"); answers tailored to elsewhere are flagged. */
  markets: z
    .string({ error: "Markets must be text" })
    .trim()
    .max(200, "List at most a few markets")
    .regex(/^[\p{L} ,.'()|;-]*$/u, "List markets as names, e.g. United States, United Kingdom, Europe")
    .optional(),
  /** Language code for the provider, e.g. "en", "de", "pt-BR". */
  providerLanguage: z
    .string({ error: "The language must be text" })
    .trim()
    .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, "Use a language code such as en, de or pt-BR")
    .optional(),
});

/** Saved API keys: "" or null clears one; a masked value ("sk-…••••1234") means unchanged. */
export const byokSchema = z.strictObject(
  Object.fromEntries(
    BYOK_PROVIDERS.map((p) => [p, z.string({ error: `${p} key must be text` }).max(LIMITS.apiKey, "That key is too long").nullable().optional()]),
  ) as Record<ByokProvider, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
);
