import { COMMON_WORDS } from "./common-words";
import { namesEntity, proseOf } from "./mentions";
import { canonicalCountry } from "./localisation";

/**
 * Companies the engines name that are not tracked yet, as suggestions for the Competitors page.
 *
 * Candidates come from the structure engines use to present vendors: a list item or heading that
 * starts with a brand-like name ("1. Retell AI — ...", "Vapi", "CallFlows AI: ..."). A candidate is
 * kept only when it heads an item in at least two answers and is named in at least `minAnswers`
 * answers, so one-off words and generic headings ("Pricing", "Best for") drop out. Nothing is
 * tracked automatically; the user decides.
 */
export interface CompanySuggestion {
  name: string;
  /** Answers naming it (word-bounded, anywhere in the answer). */
  answers: number;
  /** Distinct questions whose answers name it. */
  questions: number;
  engines: Record<string, number>;
  /** A cited domain that looks like the company's own site, when one was cited. */
  domain: string | null;
}

/** Generic headings engines use around vendor lists; never company names. */
const GENERIC = new Set<string>([
  ...`website pricing price prices best goal goals fix summary features feature example examples important sources source yes no tip tips note
  notes pros cons overview conclusion recommendation recommendations verdict why how what when who metric metrics cost costs setup channels channel
  integrations integration focus tactics action actions impact platform platforms tradeoffs cta first second third custom other others email sms
  whatsapp voice ai subject post abandoned high low medium under over problem solution writing step week day option options strengths weaknesses
  limitations considerations caveat caveats final benefits risks compliance consent timing script template results data stats comparison
  alternatives free paid enterprise starter pro basic plus phase stage month year today tools tool apps app software vendor vendors company
  companies brand brands store stores customers customer shoppers checkout cart carts recovery support sales marketing retention upsell upsells
  subscription subscriptions payments europe`.split(/\s+/),
  "best for", "key features", "the fix", "the problem", "the pitch", "bottom line", "use case", "use cases", "ideal for", "good for", "watch out",
  "next steps", "quick answer", "short answer", "my recommendation", "summary recommendation", "top picks", "best options", "pricing model",
  "what it does", "why it fits", "how it works", "key takeaway", "shopify app store", "united states", "north america", "trade-off",
].filter(Boolean));

/** Big platforms answers mention constantly; they are not the vendors a buyer compares. */
const PLATFORMS = new Set(
  "shopify shopify plus shopify flow google amazon meta facebook instagram tiktok apple microsoft openai chatgpt gemini perplexity copilot reddit youtube linkedin twitter x wordpress woocommerce bigcommerce magento stripe paypal twilio zapier hubspot salesforce gmail outlook".split(
    " "
  )
);

const TOKEN = String.raw`(?:[A-Z][\p{L}\p{N}.&'+-]*|[0-9][\p{L}\p{N}.-]*|AI|IO|ai|io)`;
const HEADING = new RegExp(String.raw`^\s*(?:\d{1,2}[.)]\s+|[-*•·]\s+|#+\s*)?(${TOKEN}(?: ${TOKEN}){0,3})(?=\s*(?:[—–:(|]|-\s|$))`, "u");
const NUMBERED = /^(step|email|week|day|option|tier|plan|phase|part|section|month|stage|level|round|test|version)\s*\d/i;
const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

/** Brand-like: not a generic heading, a platform, a country, a date, a number or a lone common word. */
function brandLike(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.length < 3 || name.length > 40) return false;
  if (!/\p{L}{2}/u.test(name) || /^(under|over|from|up to|about)\s+\d/i.test(name)) return false;
  if (GENERIC.has(lower) || PLATFORMS.has(lower) || NUMBERED.test(name) || MONTHS.test(name)) return false;
  if (canonicalCountry(name)) return false;
  const words = lower.split(/\s+/);
  if (words.every((w) => GENERIC.has(w) || COMMON_WORDS.has(w) || PLATFORMS.has(w))) {
    // "Northwind Voice" style names are all common words; keep them only with a brand signal
    return /[a-z][A-Z]|\.(io|ai|com|co)\b/.test(name);
  }
  return true;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function discoverCompanies(
  answers: Array<{ text: string; engine: string; promptId: string }>,
  trackedTerms: string[][],
  opts: { citedDomains?: string[]; minAnswers?: number; limit?: number } = {}
): CompanySuggestion[] {
  const minAnswers = opts.minAnswers ?? 3;
  const proses = answers.map((a) => proseOf(a.text));
  const headedIn = new Map<string, Set<number>>();
  proses.forEach((prose, i) => {
    for (const line of prose.split("\n")) {
      if (line.length > 220) continue;
      const m = line.match(HEADING);
      if (!m) continue;
      const name = m[1].replace(/[.,:;]+$/, "").trim();
      if (!brandLike(name)) continue;
      if (trackedTerms.some((terms) => namesEntity(name, terms))) continue;
      (headedIn.get(name) ?? headedIn.set(name, new Set()).get(name)!).add(i);
    }
  });

  const domainFor = (name: string): string | null => {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const short = key.replace(/(ai|io|hq|app)$/, "");
    for (const d of opts.citedDomains || []) {
      const stem = d.toLowerCase().replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, "");
      if (stem && (stem === key || (short.length >= 4 && stem === short) || stem === `${short}ai` || stem === `get${short}`)) return d.toLowerCase().replace(/^www\./, "");
    }
    return null;
  };

  // Regulators and public bodies are cited a lot but are not vendors
  const PUBLIC = /(\.gov(\.[a-z]{2})?|\.gc\.ca|ico\.org\.uk|europa\.eu|\.edu|\.ac\.[a-z]{2}|\.mil)$/;
  // Shape alone is weak evidence ("Monthly", "Friction"); a matching cited site or a brand-shaped name is required
  const shaped = (name: string) => /[a-z][A-Z]|\.(io|ai|co)\b/.test(name);
  const out: CompanySuggestion[] = [];
  for (const [name, heads] of headedIn) {
    if (heads.size < 2) continue;
    const domain = domainFor(name);
    if (domain && PUBLIC.test(domain)) continue;
    if (!domain && !shaped(name)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "u");
    const hits = proses.map((p, i) => (re.test(p) ? i : -1)).filter((i) => i >= 0);
    if (hits.length < minAnswers) continue;
    const engines: Record<string, number> = {};
    for (const i of hits) engines[answers[i].engine] = (engines[answers[i].engine] || 0) + 1;
    out.push({ name, answers: hits.length, questions: new Set(hits.map((i) => answers[i].promptId)).size, engines, domain });
  }
  // "Ava" and "Ava AI" are one company: keep the specific name unless the short one is far more common
  out.sort((a, b) => b.name.length - a.name.length);
  const kept: CompanySuggestion[] = [];
  for (const s of out) {
    const longer = kept.findIndex((k) => k.name.startsWith(`${s.name} `));
    if (longer >= 0) {
      if (s.answers > kept[longer].answers * 2) kept[longer] = { ...s, domain: s.domain || kept[longer].domain };
      continue;
    }
    kept.push(s);
  }
  return kept.sort((a, b) => b.answers - a.answers).slice(0, opts.limit ?? 20);
}
