/**
 * One rule for every website field (client domain, competitor domains, in onboarding and Settings).
 * Accepts what people paste ("https://www.example.com/pricing") and reduces it to "example.com".
 */
export function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

/** A cleaned domain looks like a website: labels separated by dots, no spaces or commas. */
export function isValidDomain(clean: string): boolean {
  return /^(?!-)[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(clean);
}

/** A hint when cleaning changed what was typed, e.g. "Saved as example.com". */
export function cleanedHint(raw: string): string | null {
  const clean = cleanDomain(raw);
  return raw.trim() && clean !== raw.trim() && isValidDomain(clean) ? `Saved as ${clean}` : null;
}

/** For an invalid entry, a suggestion when a comma or space stands in for the dot ("example,com"). */
export function domainError(raw: string): string | null {
  if (!raw.trim()) return null;
  const clean = cleanDomain(raw);
  if (isValidDomain(clean)) return null;
  const guess = clean.replace(/[\s,;]+/g, ".");
  return isValidDomain(guess) ? `That doesn't look like a website. Did you mean ${guess}?` : "That doesn't look like a website. Use a format like example.com";
}
