/** Domain matching shared by the report pages, using the same rules as the crawler. */

export const normalizeDomain = (d: string) =>
  (d || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

/** True when `domain` is `target` or one of its subdomains (never a substring elsewhere in a URL). */
export const domainMatches = (domain: string, target: string) => {
  const d = normalizeDomain(domain);
  const t = normalizeDomain(target);
  return t !== "" && (d === t || d.endsWith(`.${t}`));
};
