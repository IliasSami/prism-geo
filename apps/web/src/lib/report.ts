import { loadReportInput, type BrandRecord } from "@prismgeo/db";
import { buildVisibilityReport, type Report } from "@prismgeo/core";

/**
 * One measured picture of a brand's AI-search visibility, computed from stored runs only, for the
 * decision pages (Overview, Visibility, Opportunities). The computation lives in @prismgeo/core
 * (`buildVisibilityReport`) and the row loading in @prismgeo/db (`loadReportInput`), so the
 * dashboard, MCP and exports can share one implementation.
 *
 * Field contract
 * --------------
 * Existing fields keep their meaning, with these precisions:
 *   Rate.hits / Rate.n        raw answer counts (unchanged).
 *   Rate.pct                  mean over questions of each question's hit share (equals hits/n when
 *                             every question has one answer).
 *   Rate.low / Rate.high      95% Wilson interval on the prompt-clustered effective sample size
 *                             (answers to the same question are correlated; the unit is questions).
 *   EntityRow.mentioned/cited per-entity denominators: answers to prompts that name the entity are
 *                             left out of that entity's n (they cannot count for it).
 *   EntityRow.avgPosition     mean rank among tracked vendors, echoes of the prompt excluded.
 *   PromptRow.youMentioned    on branded prompts, the brand's real presence in the answers.
 *   entities / competitors    paused (inactive) competitors are neither tracked nor reported;
 *                             mentions are matched by competitor id, so a rename keeps history.
 *   failures.noAnswer         no readable answer, truncated answer or engine error only; network
 *                             and setup failures are no longer counted here.
 *
 * New fields
 * ----------
 *   Rate.questions            number of questions behind the rate; Rate.nEff effective sample size.
 *   EntityRow.id              competitor id, or "brand".
 *   EntityRow.avgListPosition mean list/table position when the answer was a list.
 *   EntityRow.caveats         positive mentions that carried a caveat ("best for X, but pricey").
 *   EntityRow.mentionedStratified  engine-stratified mention rate (percent), see `headline`.
 *   PromptRow.brandedNamedRuns     branded prompts: answers naming the brand (echo included); null otherwise.
 *   failures.network / setup / promptRemoved (and the same keys in failures.byEngine).
 *   totalQuestions            active unbranded prompts.
 *   coverage[]                per engine: promptsCovered / activeUnbrandedPrompts, share, inHeadline
 *                             (share >= 0.5) and byIntent {covered, total}.
 *   captureMethods[]          per engine: answers by capture method, dominant method, and `mixed`
 *                             when more than 20% come from a non-dominant method.
 *   aioTrigger                {overviews, noOverview, rate}: how often Google showed an AI Overview.
 *   headline                  engine-stratified headline: mean of per-engine brand rates over engines
 *                             covering >= 50% of questions ({engines, excluded, brandMentionedPct,
 *                             brandCitedPct}); never pools raw counts across unequal coverage.
 *   brandAccuracy             answers citing/naming a look-alike of the brand's domain: counts,
 *                             confusionRate, lookalikeDomains [{domain, answers}], examples (last 5).
 *   entitiesByEngine          `entities` restricted to one engine (same shape), keyed by engine id.
 */

export { ENGINE_LABELS, rate, findOpportunities } from "@prismgeo/core";
export type { Rate, EntityRow, EngineRow, PromptRow, FailureSummary, Report, Opportunity } from "@prismgeo/core";

export function buildReport(brand: BrandRecord): Report {
  return buildVisibilityReport(loadReportInput(brand));
}
