/**
 * Countries a search can be asked from (Settings → Search location), each with the languages
 * widely spoken there. Names are the location names DataForSEO and SerpApi accept; language codes
 * are the ones their APIs and Google's `hl` take. Kept short on purpose: the main markets only.
 */
export interface SearchLanguage {
  code: string;
  label: string;
}

export interface SearchCountry {
  /** Location name, e.g. "United States". */
  name: string;
  /** ISO 3166-1 alpha-2, lower case. */
  code: string;
  /** Widely spoken languages; the first is the default. */
  languages: SearchLanguage[];
}

const L = {
  en: { code: "en", label: "English" },
  es: { code: "es", label: "Spanish" },
  fr: { code: "fr", label: "French" },
  de: { code: "de", label: "German" },
  it: { code: "it", label: "Italian" },
  nl: { code: "nl", label: "Dutch" },
  sv: { code: "sv", label: "Swedish" },
  pt: { code: "pt", label: "Portuguese" },
  hi: { code: "hi", label: "Hindi" },
  ar: { code: "ar", label: "Arabic" },
  ja: { code: "ja", label: "Japanese" },
} satisfies Record<string, SearchLanguage>;

export const SEARCH_COUNTRIES: SearchCountry[] = [
  { name: "United States", code: "us", languages: [L.en, L.es] },
  { name: "United Kingdom", code: "gb", languages: [L.en] },
  { name: "Canada", code: "ca", languages: [L.en, L.fr] },
  { name: "Australia", code: "au", languages: [L.en] },
  { name: "Ireland", code: "ie", languages: [L.en] },
  { name: "New Zealand", code: "nz", languages: [L.en] },
  { name: "Germany", code: "de", languages: [L.de, L.en] },
  { name: "France", code: "fr", languages: [L.fr] },
  { name: "Spain", code: "es", languages: [L.es] },
  { name: "Italy", code: "it", languages: [L.it] },
  { name: "Netherlands", code: "nl", languages: [L.nl, L.en] },
  { name: "Sweden", code: "se", languages: [L.sv, L.en] },
  { name: "India", code: "in", languages: [L.en, L.hi] },
  { name: "Singapore", code: "sg", languages: [L.en] },
  { name: "United Arab Emirates", code: "ae", languages: [L.en, L.ar] },
  { name: "Brazil", code: "br", languages: [L.pt] },
  { name: "Mexico", code: "mx", languages: [L.es] },
  { name: "Japan", code: "jp", languages: [L.ja] },
];

/** The listed country for a location name ("United States", or "New York,New York,United States"), or null. */
export function searchCountry(location: string | null | undefined): SearchCountry | null {
  const last = (location || "").split(",").pop()?.trim().toLowerCase();
  return SEARCH_COUNTRIES.find((c) => c.name.toLowerCase() === last) ?? null;
}

/** The language to use in a country: the chosen one when it is spoken there, otherwise the country's main language. */
export function languageFor(location: string | null | undefined, language: string | null | undefined): string {
  const country = searchCountry(location);
  if (!country) return language || "en";
  return country.languages.some((l) => l.code === language) ? language! : country.languages[0].code;
}
