import { hostKey } from "../url/canonical";

/**
 * Entity confusion: an answer that cites or names a domain that looks like the brand's own but
 * is not it (brand northwindvoice.ai, answer about northwindvoiceai.com or northwind-voice.io).
 * Such answers usually describe a different company under the brand's name.
 */

const DOMAIN_IN_TEXT = /(?<![\w@.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi;
const FILE_LIKE = /\.(png|jpe?g|gif|svg|webp|pdf|js|css|html?|php|aspx?|json|xml|txt|md|csv|zip)$/i;

/** Domains written in a text ("see northwindvoiceai.com", URLs included), lower-cased, without www. */
export function domainsInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(DOMAIN_IN_TEXT)) {
    const d = hostKey(m[1]);
    if (!FILE_LIKE.test(d) && /[a-z]/.test(d.split(".").pop() || "")) out.add(d);
  }
  return [...out];
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * True when one label of the domain starts or ends with the stem at a word boundary (label edge
 * or dash): "northwindvoiceai", "northwind-voice", "getnorthwindvoice" do; "blacmeadow" does not
 * contain "acme" at a boundary.
 */
function labelHasStem(domain: string, stem: string): boolean {
  return domain.split(".").some((label) => {
    const parts = label.split("-").map(compact);
    for (let i = 0; i < parts.length; i++) {
      if (parts.slice(i).join("").startsWith(stem)) return true;
      if (parts.slice(0, i + 1).join("").endsWith(stem)) return true;
    }
    return false;
  });
}

/** Country endings a company registers its own name under ("de", "co.uk", "com.au"), and ".com". */
const REGIONAL_SUFFIX = /^([a-z]{2}|com|(co|com|org|net|ac|gov)\.[a-z]{2})$/;
/** Country codes used as start-up endings: "acme.io" next to acme.com is usually another company. */
const VANITY_CCTLDS = new Set(["io", "ai", "co", "me", "tv", "gg", "so", "sh", "ly", "fm", "to", "cc", "ws", "is", "it", "app"]);

/** The brand's own name under a country ending ("acme.de", "shop.acme.co.uk" for acme.com): regional, not confusion. */
function isRegionalDomain(domain: string, brandLabel: string): boolean {
  const labels = domain.split(".");
  const at = labels.lastIndexOf(brandLabel);
  if (at === -1 || at === labels.length - 1) return false;
  const suffix = labels.slice(at + 1).join(".");
  return REGIONAL_SUFFIX.test(suffix) && !VANITY_CCTLDS.has(suffix);
}

/**
 * Lookalike domains of the brand in an answer's text and citations: domains with a label that
 * starts or ends with the brand's domain stem (ignoring dashes), that are neither the brand domain
 * nor one of its subdomains, nor the brand's own name under a regional ending. Returns [] when the
 * brand stem is too short to compare safely (< 4 characters).
 */
export function lookalikeDomains(text: string, citationDomains: string[], brandDomain: string): string[] {
  const brand = hostKey(brandDomain);
  if (!brand.includes(".")) return [];
  const labels = brand.split(".");
  const stem = compact(labels[0]);
  if (stem.length < 4) return [];
  const candidates = new Set([...domainsInText(text), ...citationDomains.map(hostKey)]);
  return [...candidates]
    .filter((d) => d && d !== brand && !d.endsWith(`.${brand}`) && labelHasStem(d, stem) && !isRegionalDomain(d, labels[0]))
    .sort();
}
