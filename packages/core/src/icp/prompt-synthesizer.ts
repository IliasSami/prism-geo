import type { IntentType, PersonaDimension } from "../types/index";

export interface BrandProfileInput {
  brandName: string;
  domain: string;
  /** Free-text description of the brand. Only used to derive a category when none is given. */
  niche: string;
  /** Short product category, 2-8 words ("AI voice agent for abandoned checkout recovery"). */
  category?: string;
  aliases: string[];
  competitors: Array<{ name: string; domain: string }>;
  /** Customer pains, capabilities ("Works with Klaviyo") or pricing models ("Pay per recovered order"). */
  valuePropositions: string[];
}

export interface GeneratedPrompt {
  queryText: string;
  intentType: IntentType;
  personaDimension: PersonaDimension;
  hypothesis: string;
}

/** What a value proposition describes, which decides how it can be asked about. */
export type ValuePropKind = "pain" | "capability" | "pricing";

const PRODUCT_NOUNS =
  /\b(agents?|tools?|software|platforms?|apps?|applications?|assistants?|services?|solutions?|systems?|bots?|chatbots?|crms?|trackers?|plugins?|extensions?|suites?|engines?|providers?|vendors?|marketplaces?|dashboards?|apis?)$/i;
const CAPABILITY_VERB =
  /^(calls?|rings?|phones?|dials?|reaches?|contacts?|emails?|messages?|notifies|alerts?|reminds?|works?|integrates?|syncs?|connects?|sends?|tracks?|automates?|recovers?|answers?|books?|qualifies|routes?|handles?|supports?|offers?|provides?|lets|helps?|turns?|reduces?|increases?|improves?|captures?|detects?|monitors?|generates?|creates?|runs?|plugs?|uses?|follows?|texts?|writes?|reads?|speaks?|schedules?|finds?|scores?|builds?|launches?|replaces?|cuts?|boosts?|delivers?|includes?|comes?)$/i;
const PRICING = /\b(pay|pays|paid|pricing|priced|price|per (recovered|order|call|minute|seat|user|month|lead|sale|conversion)|free (plan|tier|trial)|commission|subscription|flat (fee|rate)|no (monthly|setup) fee|revenue share|%|percent)\b/i;
const PAIN = /\b(abandon\w*|lost|losing|lose|churn\w*|missed|miss|slow|manual|wasted?|low|drop\w*|struggl\w*|too many|can'?t|cannot|no time|leak\w*|expensive|costly|ignored?|unanswered|bounce\w*)\b/i;
const INTEGRATION = /^(?:works|integrates|syncs|connects|plugs)\s+(?:in(?:to)?\s+|with\s+|to\s+)(.+)$/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stripEnd = (s: string) => s.trim().replace(/[\s.!?;:,]+$/, "");

/** Classifies a value proposition as a customer pain, a capability, or a pricing model. */
export function classifyValueProp(vp: string): ValuePropKind {
  const text = stripEnd(vp);
  if (PRICING.test(text)) return "pricing";
  const first = words(text)[0] || "";
  if (CAPABILITY_VERB.test(first)) return "capability";
  if (PAIN.test(text)) return "pain";
  return "capability";
}

/** Nouns with no plural form in buyer speech ("accounting software", not "softwares"). */
const UNCOUNTABLE = /^(software|hardware|middleware|firmware|analytics|tooling|crm|erp|seo|insurance|equipment|data|feedback)$/i;
function pluralise(noun: string): string {
  if (UNCOUNTABLE.test(noun)) return noun;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return noun.endsWith("s") && !/(ss|us)$/i.test(noun) ? noun : `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}
function singularise(noun: string): string {
  if (/ies$/i.test(noun)) return `${noun.slice(0, -3)}y`;
  if (/(ss|us)$/i.test(noun)) return noun;
  if (/(ches|shes|xes|zes)$/i.test(noun)) return noun.slice(0, -2);
  if (/s$/i.test(noun) && !/^(saas|sms|crms?|apis?)$/i.test(noun)) return noun.slice(0, -1);
  if (/^(crms|apis)$/i.test(noun)) return noun.slice(0, -1);
  return noun;
}

/** A clean category phrase: 2-6 words, no trailing clause, no leading "X is a". */
function cleanCategory(raw: string, brandName: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  if (brandName) s = s.replace(new RegExp(`^${brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(is|are|offers|provides|builds)\\s+`, "i"), "");
  s = s.replace(/^(we|it)\s+(are|is|offer|provide|build)\s+/i, "");
  s = s.replace(/^(an?|the|your|our)\s+/i, "");
  s = s.split(/\s+(?:that|which|who|whose|so|to help|helping|designed|built|where)\b|[.;!?()]/i)[0];
  s = stripEnd(s);
  let w = words(s);
  if (w.length > 6) {
    const forAt = w.findIndex((x, i) => i > 0 && /^(for|in|on|with)$/i.test(x));
    w = forAt > 0 && forAt <= 6 ? w.slice(0, forAt) : w.slice(0, 6);
  }
  return w.join(" ");
}

/**
 * The category the prompts ask about: the explicit `category` when it is 2-8 words, otherwise a
 * short noun phrase derived from the description (never the whole description sentence).
 * Returns null when nothing usable can be derived.
 */
export function deriveCategory(profile: Pick<BrandProfileInput, "category" | "niche" | "brandName">): string | null {
  const explicit = stripEnd(profile.category || "");
  if (explicit && words(explicit).length >= 1 && words(explicit).length <= 8) return explicit;
  const desc = (profile.niche || "").trim();
  if (!desc) return null;
  const candidates = desc
    .split(/\s*[:—–]\s+|\s+-\s+|\.\s+/)
    .map((c) => cleanCategory(c, profile.brandName))
    .filter((c) => words(c).length >= 2 && words(c).length <= 6);
  const withProduct = candidates.find((c) => PRODUCT_NOUNS.test(c));
  return withProduct || candidates[0] || null;
}

/** Singular and plural forms used in templates ("AI voice agent" / "AI voice agents", "cart recovery tool(s)"). */
export function categoryForms(category: string): { one: string; many: string; article: string } {
  const w = words(category);
  // The head noun comes before a qualifying phrase: "AI voice agents | for abandoned checkout recovery"
  const cut = w.findIndex((x, i) => i > 0 && /^(for|with|that|which|to|in|on|from|by|of)$/i.test(x));
  const head = cut > 0 ? w.slice(0, cut) : w;
  const tail = cut > 0 ? ` ${w.slice(cut).join(" ")}` : "";
  const last = head[head.length - 1] || "";
  let one: string;
  let many: string;
  if (PRODUCT_NOUNS.test(last)) {
    one = [...head.slice(0, -1), singularise(last)].join(" ") + tail;
    many = [...head.slice(0, -1), pluralise(singularise(last))].join(" ") + tail;
  } else {
    one = `${category} tool`;
    many = `${category} tools`;
  }
  const article = /^[aeiou]/i.test(one) && !/^(u[nr]i|one|eu)/i.test(one) ? "an" : /^[A-Z]{2,}/.test(one) && /^[AEFHILMNORSX]/.test(one) ? "an" : "a";
  return { one, many, article };
}

/** Audience named in the description ("for ecommerce brands"), if any. */
function audienceOf(desc: string): string | null {
  const m = /\bfor\s+((?:[a-z0-9&'-]+\s){0,3}(?:brands|stores|teams|companies|businesses|agencies|startups|retailers|merchants|founders|marketers|clinics|firms|shops|sellers))\b/i.exec(desc || "");
  return m ? m[1].trim() : null;
}

/** Rotating, de-duplicated prompt builder. */
class PromptSet {
  private readonly items: GeneratedPrompt[] = [];
  private readonly seen = new Set<string>();
  add(queryText: string, intentType: IntentType, personaDimension: PersonaDimension, hypothesis: string) {
    const q = queryText.replace(/\s+/g, " ").trim();
    const key = q.toLowerCase();
    if (!q || this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ queryText: q, intentType, personaDimension, hypothesis });
  }
  get list() {
    return this.items;
  }
}

export class IcpPromptSynthesizer {
  /**
   * Buyer questions for a brand, from its category, value propositions and competitors.
   *
   * - Templates are typed by input: pains become symptom questions, capabilities become "which
   *   tools can ..." or integration questions, pricing models become pricing questions.
   * - Each intent has paraphrases (formal, casual, symptom) and persona variants (founder,
   *   ecommerce director, CRO) to average out wording effects.
   * - Unbranded prompts never name the brand; at most ~20% of them name a competitor, rotating
   *   through the competitor list.
   * - Branded prompts use the natural forms buyers type ("is X legit", "X reviews", "X pricing")
   *   and never include the domain, so engines are not primed with the right site.
   * Ordered most valuable first, because callers may truncate to a prompt limit.
   */
  public static generatePrompts(profile: BrandProfileInput): GeneratedPrompt[] {
    const brand = (profile.brandName || "").trim();
    const category = deriveCategory(profile);
    const { one, many, article } = categoryForms(category || "software");
    const audience = audienceOf(profile.niche || "");
    const forAudience = audience ? ` for ${audience}` : "";
    const ecommerce = /\b(e-?commerce|shopify|store|shop|retail|dtc|checkout|cart)\b/i.test(`${profile.niche} ${category || ""}`);
    const director = ecommerce ? { persona: "ecom_director" as const, title: "an ecommerce director" } : { persona: "head_of_growth" as const, title: "a head of growth" };
    const peers = ecommerce ? "other stores" : "other companies";
    const competitors = profile.competitors.map((c) => (c.name || "").trim()).filter(Boolean);
    const valueProps = profile.valuePropositions.map((v) => stripEnd(v)).filter((v) => words(v).length >= 2);
    const set = new PromptSet();

    if (category) {
      // 1. Category discovery: formal, casual, persona variants
      set.add(`What are the best ${many}${forAudience} right now?`, "category", "growth_buyer", "Unbranded category shortlist: who the engines recommend by default.");
      set.add(`Which ${one} would you recommend${forAudience}?`, "category", "head_of_growth", "Recommendation phrasing of the category shortlist.");
      set.add(`best ${lowerFirst(many)}${forAudience}`, "category", "growth_buyer", "Search-style short query, as typed into a search box.");
      set.add(`I'm a founder of a small${audience ? ` ${audience.replace(/s$/, "")}` : " company"}: is ${article} ${one} worth it, and which one should I start with?`, "category", "founder", "Founder persona: worth-it question with a shortlist.");
      set.add(`As ${director.title}, how do I choose ${article} ${one}?`, "category", director.persona, "Director persona: selection criteria and vendors named while answering.");
    }

    // 2. Value propositions, typed
    for (const vp of valueProps.slice(0, 6)) {
      const kind = classifyValueProp(vp);
      if (kind === "pricing") {
        const model = lowerFirst(vp).replace(/^(we\s+)?(pay|charges?|priced|pricing:?)\s+(only\s+)?/i, "");
        const phrase = /^per\s/i.test(model) ? `charge only ${model}` : `offer ${model}`;
        set.add(`Are there ${category ? many : "tools"} that ${phrase}?`, "pricing", "founder", `Pricing-model question from "${vp}".`);
        continue;
      }
      if (kind === "capability") {
        const integration = INTEGRATION.exec(vp);
        if (integration) {
          const target = stripEnd(integration[1]);
          set.add(`Which ${category ? many : "tools"} integrate with ${target}?`, "dilemma", "technical_lead", `Integration question from "${vp}".`);
          set.add(`does anything plug into ${target} for this, or do I need custom work?`, "dilemma", director.persona, `Casual integration phrasing from "${vp}".`);
        } else {
          const clause = lowerFirst(vp);
          set.add(`Is there ${category ? `${article} ${one}` : "a tool"} that ${clause}?`, "dilemma", "head_of_growth", `Capability question from "${vp}".`);
        }
        continue;
      }
      // pain: symptom-first phrasing in buyer language
      const pain = lowerFirst(vp);
      set.add(`${upperFirst(pain)}. What actually works to fix this?`, "dilemma", director.persona, `Symptom question from the pain "${vp}".`);
      set.add(`how do ${peers} deal with this: ${pain}?`, "dilemma", "founder", `Casual symptom phrasing of "${vp}".`);
    }

    if (category) {
      // 3. Pricing and risk
      set.add(`How much does ${article} ${one} typically cost, and which pricing models are common?`, "pricing", "founder", "Price-led evaluation, usually the last blocker before a demo.");
      set.add(`Is ${article} ${one} worth the money for a smaller team?`, "pricing", "cro", "ROI phrasing from a revenue owner.");
      set.add(`What should I watch out for when choosing ${article} ${one}?`, "risk", "cro", "Risk and vetting criteria; reveals which vendors are cited as trustworthy.");
      set.add(`What are the downsides of using ${article} ${one}?`, "risk", director.persona, "Objection-led question; shows which vendors are named with caveats.");
    }

    // 4. Competitor-anchored prompts: at most ~20% of the unbranded set, rotating competitors
    const unbrandedSoFar = set.list.length;
    const anchoredBudget = competitors.length ? Math.floor(unbrandedSoFar / 4) : 0; // a / (n + a) <= 20%
    const anchored: Array<[string, string]> = [];
    for (let i = 0; i < Math.min(anchoredBudget, competitors.length * 2); i++) {
      const c = competitors[i % competitors.length];
      if (i < competitors.length) anchored.push([`What are the best alternatives to ${c}?`, `Alternatives query against ${c}.`]);
      else {
        const other = competitors[(i + 1) % competitors.length];
        if (other !== c) anchored.push([`${c} vs ${other}: which is better, and what else should I consider?`, `Head-to-head between ${c} and ${other}, open to alternatives.`]);
      }
    }
    for (const [q, h] of anchored) set.add(q, "comparison", "head_of_growth", h);

    // 5. Branded prompts (separated from headline rates by the report)
    if (brand) {
      set.add(`Is ${brand} legit?`, "direct", "founder", "Branded trust check, as buyers type it; exposes look-alike confusion.");
      set.add(`${brand} reviews`, "direct", "growth_buyer", "Branded review lookup.");
      set.add(`${brand} pricing`, "direct", "founder", "Branded pricing lookup.");
      set.add(`What does ${brand} do, and who is it for?`, "direct", "growth_buyer", "Entity understanding: whether engines reflect current positioning.");
      if (competitors[0]) set.add(`${brand} vs ${competitors[0]}`, "direct", "head_of_growth", "Branded head-to-head.");
    }
    return set.list;
  }
}
