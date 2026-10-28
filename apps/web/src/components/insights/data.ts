import { getRawDb } from "@prismgeo/db";

/**
 * Small server-side reads used by the insight pages on top of lib/report.ts. Anything that is a
 * metric belongs in the shared report (buildVisibilityReport), never here.
 */

/** Counts that drive the first-run checklist. */
export function setupCounts(brandId: string): { competitors: number; prompts: number; answers: number } {
  const one = (sql: string) => Number((getRawDb().prepare(sql).get(brandId) as { n: number }).n);
  return {
    competitors: one("SELECT COUNT(*) AS n FROM competitors WHERE brand_id = ?"),
    prompts: one("SELECT COUNT(*) AS n FROM prompts WHERE brand_id = ? AND active = 1"),
    answers: one("SELECT COUNT(*) AS n FROM prompt_runs WHERE brand_id = ?"),
  };
}

/** Tracked competitors, for pages that list them before any answers exist. */
export function trackedCompetitors(brandId: string): Array<{ name: string; domain: string }> {
  return (getRawDb().prepare("SELECT name, domain FROM competitors WHERE brand_id = ? ORDER BY name").all(brandId) as Array<{ name: string; domain: string }>).map(
    (c) => ({ name: String(c.name), domain: String(c.domain) })
  );
}
