/**
 * Answers tailored to where the crawler runs, not to the market being measured.
 *
 * Logged-out engines localise by the visitor's location: run from Dhaka, ChatGPT adds sections
 * such as "Bangladesh / South Asia" or "if your business operates in Bangladesh". Those answers
 * describe a different buyer, so they are flagged (flags_json.localisedTo) and reported, never
 * silently mixed in. Only strong signals count, and only for the machine's own country (or its
 * region) when that country is not a market being measured and the question does not name it.
 */

interface CountryInfo {
  /** Names and demonyms, matched word-bounded and case-insensitively. */
  names: string[];
  /** Region names an answer may use instead ("South Asia"). */
  regions: string[];
  /** Currency symbols and codes, matched next to an amount. */
  currency: string[];
  /** IANA time zones in the country (to detect where this machine runs). */
  zones: string[];
}

const COUNTRIES: Record<string, CountryInfo> = {
  Bangladesh: { names: ["Bangladesh", "Bangladeshi", "Dhaka", "Chittagong"], regions: ["South Asia", "South Asian"], currency: ["৳", "BDT", "Tk"], zones: ["Asia/Dhaka"] },
  India: { names: ["India", "Indian"], regions: ["South Asia", "South Asian"], currency: ["₹", "INR", "Rs"], zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  Pakistan: { names: ["Pakistan", "Pakistani"], regions: ["South Asia", "South Asian"], currency: ["PKR", "Rs"], zones: ["Asia/Karachi"] },
  "Sri Lanka": { names: ["Sri Lanka", "Sri Lankan"], regions: ["South Asia", "South Asian"], currency: ["LKR"], zones: ["Asia/Colombo"] },
  Nepal: { names: ["Nepal", "Nepali", "Nepalese"], regions: ["South Asia", "South Asian"], currency: ["NPR"], zones: ["Asia/Kathmandu", "Asia/Katmandu"] },
  Nigeria: { names: ["Nigeria", "Nigerian", "Lagos"], regions: ["West Africa"], currency: ["₦", "NGN"], zones: ["Africa/Lagos"] },
  Kenya: { names: ["Kenya", "Kenyan", "Nairobi"], regions: ["East Africa"], currency: ["KES", "KSh"], zones: ["Africa/Nairobi"] },
  "South Africa": { names: ["South Africa", "South African"], regions: [], currency: ["ZAR"], zones: ["Africa/Johannesburg"] },
  Egypt: { names: ["Egypt", "Egyptian", "Cairo"], regions: ["MENA", "Middle East"], currency: ["EGP"], zones: ["Africa/Cairo"] },
  Philippines: { names: ["Philippines", "Filipino", "Manila"], regions: ["Southeast Asia"], currency: ["₱", "PHP"], zones: ["Asia/Manila"] },
  Indonesia: { names: ["Indonesia", "Indonesian", "Jakarta"], regions: ["Southeast Asia"], currency: ["IDR", "Rp"], zones: ["Asia/Jakarta"] },
  Vietnam: { names: ["Vietnam", "Vietnamese"], regions: ["Southeast Asia"], currency: ["₫", "VND"], zones: ["Asia/Ho_Chi_Minh", "Asia/Saigon"] },
  Malaysia: { names: ["Malaysia", "Malaysian"], regions: ["Southeast Asia"], currency: ["MYR", "RM"], zones: ["Asia/Kuala_Lumpur"] },
  Singapore: { names: ["Singapore", "Singaporean"], regions: ["Southeast Asia"], currency: ["SGD", "S$"], zones: ["Asia/Singapore"] },
  Thailand: { names: ["Thailand", "Thai"], regions: ["Southeast Asia"], currency: ["฿", "THB"], zones: ["Asia/Bangkok"] },
  "United Arab Emirates": { names: ["UAE", "United Arab Emirates", "Dubai", "Emirati"], regions: ["GCC", "Middle East", "MENA"], currency: ["AED"], zones: ["Asia/Dubai"] },
  "Saudi Arabia": { names: ["Saudi Arabia", "Saudi", "KSA", "Riyadh"], regions: ["GCC", "Middle East", "MENA"], currency: ["SAR"], zones: ["Asia/Riyadh"] },
  Turkey: { names: ["Turkey", "Türkiye", "Turkish", "Istanbul"], regions: [], currency: ["₺", "TRY"], zones: ["Europe/Istanbul"] },
  Brazil: { names: ["Brazil", "Brazilian", "Brasil"], regions: ["Latin America", "LATAM"], currency: ["R$", "BRL"], zones: ["America/Sao_Paulo"] },
  Mexico: { names: ["Mexico", "Mexican"], regions: ["Latin America", "LATAM"], currency: ["MXN"], zones: ["America/Mexico_City"] },
  Argentina: { names: ["Argentina", "Argentine", "Argentinian"], regions: ["Latin America", "LATAM"], currency: ["ARS"], zones: ["America/Argentina/Buenos_Aires", "America/Buenos_Aires"] },
  Colombia: { names: ["Colombia", "Colombian"], regions: ["Latin America", "LATAM"], currency: ["COP"], zones: ["America/Bogota"] },
  Canada: { names: ["Canada", "Canadian"], regions: [], currency: ["CAD", "C$"], zones: ["America/Toronto", "America/Vancouver", "America/Montreal", "America/Edmonton", "America/Winnipeg", "America/Halifax"] },
  Australia: { names: ["Australia", "Australian"], regions: ["APAC"], currency: ["AUD", "A$"], zones: ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide"] },
  "New Zealand": { names: ["New Zealand", "Kiwi"], regions: ["APAC"], currency: ["NZD"], zones: ["Pacific/Auckland"] },
  Japan: { names: ["Japan", "Japanese"], regions: [], currency: ["JPY", "¥"], zones: ["Asia/Tokyo"] },
  "South Korea": { names: ["South Korea", "Korea", "Korean"], regions: [], currency: ["KRW", "₩"], zones: ["Asia/Seoul"] },
  "United Kingdom": { names: ["United Kingdom", "UK", "Britain", "British", "England"], regions: [], currency: ["£", "GBP"], zones: ["Europe/London"] },
  Ireland: { names: ["Ireland", "Irish"], regions: [], currency: [], zones: ["Europe/Dublin"] },
  Germany: { names: ["Germany", "German"], regions: ["DACH"], currency: [], zones: ["Europe/Berlin"] },
  France: { names: ["France", "French"], regions: [], currency: [], zones: ["Europe/Paris"] },
  Spain: { names: ["Spain", "Spanish"], regions: [], currency: [], zones: ["Europe/Madrid"] },
  Italy: { names: ["Italy", "Italian"], regions: [], currency: [], zones: ["Europe/Rome"] },
  Netherlands: { names: ["Netherlands", "Dutch"], regions: ["Benelux"], currency: [], zones: ["Europe/Amsterdam"] },
  Poland: { names: ["Poland", "Polish"], regions: [], currency: ["PLN", "zł"], zones: ["Europe/Warsaw"] },
  Sweden: { names: ["Sweden", "Swedish"], regions: ["Nordics"], currency: ["SEK"], zones: ["Europe/Stockholm"] },
  "United States": { names: ["United States", "USA", "U.S.", "US", "American"], regions: ["North America"], currency: [], zones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"] },
};

/** Countries in Europe, for markets entered as "Europe" or "EU". */
const EUROPE = new Set(["United Kingdom", "Ireland", "Germany", "France", "Spain", "Italy", "Netherlands", "Poland", "Sweden"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (terms: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** Canonical country for a name such as "Bangladesh", "UK", "United States"; null if unknown. */
export function canonicalCountry(name: string): string | null {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  for (const [country, info] of Object.entries(COUNTRIES)) {
    if (country.toLowerCase() === n || info.names.some((x) => x.toLowerCase() === n)) return country;
  }
  return null;
}

/** The country this machine is in, from PRISMGEO_ORIGIN_COUNTRY or its time zone; null when unknown. */
export function originCountry(env: Record<string, string | undefined> = process.env, timeZone?: string): string | null {
  const explicit = env.PRISMGEO_ORIGIN_COUNTRY?.trim();
  if (explicit) return canonicalCountry(explicit);
  const tz = timeZone ?? (env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  for (const [country, info] of Object.entries(COUNTRIES)) if (info.zones.includes(tz)) return country;
  return null;
}

/** True when `country` is one of the measured markets (country names, or "Europe"/"EU"). */
export function inMarkets(country: string, markets: string[]): boolean {
  return markets.some((m) => {
    const t = m.trim().toLowerCase();
    if (!t) return false;
    if ((t === "europe" || t === "eu" || t === "european union") && EUROPE.has(country)) return true;
    // DataForSEO locations can be "London,England,United Kingdom": any part may name the country
    return t.split(",").some((part) => canonicalCountry(part) === country);
  });
}

/**
 * The origin country (or its region) when the answer is tailored to it, else null. Strong signals
 * only: a heading line naming it, "operate / based / located / sell in <country>", "<country>-based",
 * "if you are in <country>", or a price in its currency.
 */
export function detectLocalisation(
  answer: string,
  question: string,
  opts: { origin: string | null; markets: string[] }
): string | null {
  const origin = opts.origin;
  if (!origin || !answer) return null;
  if (inMarkets(origin, opts.markets)) return null;
  const info = COUNTRIES[origin];
  if (!info) return null;
  const places = [...info.names, ...info.regions];
  // The question asked about that place: discussing it is the answer, not localisation
  if (wordRe(places).test(question)) return null;

  const alt = places.map(esc).join("|");
  // "Bangladesh market", "South Asian ecommerce": a heading may carry a qualifier or two
  const QUALIFIER = `(?:\\s+(?:market|markets|ecommerce|e-commerce|context|notes?|tips|considerations?|specifics?|sellers|stores|merchants|businesses|brands|option|options|version|focus)){0,2}`;
  const B = `(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`;
  const strong = [
    // A heading line that is the place itself: "Bangladesh", "Bangladesh / South Asia", "## India:"
    new RegExp(`^\\s*(?:#+\\s*|\\d+[.)]\\s*)?(?:\\*\\*)?${B}(?:\\s*(?:/|&|and|-|–)\\s*${B})?${QUALIFIER}(?:\\*\\*)?\\s*:?\\s*$`, "imu"),
    // "operates in Bangladesh", "based in India", "sell in", "customers in"
    new RegExp(`\\b(?:operat(?:e|es|ing)|based|located|sell(?:s|ing)?|run(?:s|ning)?|business(?:es)?|stores?|shops?|merchants?|brands?|customers?|shoppers?|market)\\s+(?:\\w+\\s+){0,2}in\\s+(?:the\\s+)?${B}`, "iu"),
    // "Bangladesh-based", "India-specific"
    new RegExp(`${B}-(?:based|specific|focused|friendly)`, "iu"),
    // "if you're in", "if you are in", "for sellers in"
    new RegExp(`\\b(?:if\\s+you(?:'re|\\s+are)?(?:\\s+\\w+){0,2}\\s+in|for\\s+(?:sellers|merchants|brands|stores|businesses|users)\\s+in|in\\s+your\\s+country,?\\s+)\\s*(?:the\\s+)?${B}`, "iu"),
  ];
  if (strong.some((re) => re.test(answer))) return origin;
  // A price in the origin's currency ("৳1,500", "BDT 500", "500 INR")
  const cur = info.currency.filter((c) => c.length > 1 || /[^\x00-\x7f]/.test(c));
  if (cur.length) {
    const C = cur.map(esc).join("|");
    if (new RegExp(`(?:(?:${C})\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:${C})(?![\\p{L}]))`, "u").test(answer)) return origin;
  }
  return null;
}
