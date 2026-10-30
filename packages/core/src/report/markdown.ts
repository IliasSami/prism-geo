import { ENGINE_LABELS, findOpportunities, type Rate, type Report } from "./visibility-report";

/**
 * A presentation-ready Markdown summary of one client's measured AI-search visibility, for sharing
 * with a team. Every number comes from the stored report: rates carry their 95% range and
 * denominator, failed engines are stated as failures, and nothing is estimated or filled in.
 */
export interface MarkdownReportMeta {
  brand: { name: string; domain: string; category?: string | null };
  /** When the report was generated (ISO). */
  generatedAt: string;
  /** Competitor names in the order they were configured (for the scope section). */
  competitors?: string[];
}

const label = (engine: string) => ENGINE_LABELS[engine] || engine;
const range = (r: Rate) => (r.n ? `${r.pct}% (likely ${r.low}–${r.high}%, ${r.hits} of ${r.n})` : "no answers");
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "–");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function renderReportMarkdown(report: Report, meta: MarkdownReportMeta): string {
  const { brand } = meta;
  const you = report.entities.find((e) => e.isTarget);
  const rivals = report.entities.filter((e) => !e.isTarget);
  const leader = rivals.slice().sort((a, b) => b.mentioned.pct - a.mentioned.pct)[0];
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(`# AI search visibility: ${brand.name}`, "");
  push(
    `${brand.domain}${brand.category ? ` · ${brand.category}` : ""} · answers captured ${
      day(report.firstCapture) === day(report.lastCapture) ? day(report.firstCapture) : `${day(report.firstCapture)} to ${day(report.lastCapture)}`
    } · generated ${day(meta.generatedAt)}`,
    ""
  );

  // Summary
  push("## Summary", "");
  if (!report.totalAnswers || !you) {
    push("No unbranded answers have been captured yet, so there is nothing to report.", "");
    return lines.join("\n");
  }
  const h = report.headline;
  push(
    `- **Named in answers:** ${brand.name} appears in ${range(you.mentioned)} of answers to ${report.totalQuestions} unbranded buyer questions.` +
      (h.brandMentionedPct !== null && h.engines.length ? ` Averaged per engine (${h.engines.map(label).join(", ")}): ${h.brandMentionedPct}%.` : ""),
    `- **Cited as a source:** ${range(you.cited)} of answers that show sources link to ${brand.domain}.`,
    leader
      ? `- **Most-named competitor:** ${leader.name}, in ${range(leader.mentioned)} of answers.`
      : "- No tracked competitor was named.",
    `- **Branded questions** (that name ${brand.name}): the answer names it in ${range(report.branded)} of cases. These are reported separately and are not part of the headline.`
  );
  const lead = report.prompts.filter((p) => !p.branded && p.active && p.status === "winning").length;
  const measured = report.prompts.filter((p) => !p.branded && p.active && p.status !== "no_data").length;
  push(`- **Questions you lead:** ${lead} of ${measured} measured unbranded questions.`, "");

  // Competitors
  push("## You vs competitors", "", "Share of unbranded answers that name each company, and of answers with sources that cite its site.", "");
  push("| Company | Named in answers | Website cited | Avg. order among tracked vendors | Positive / negative mentions |", "| --- | --- | --- | --- | --- |");
  for (const e of report.entities) {
    push(
      `| ${e.isTarget ? `**${cell(e.name)}**` : cell(e.name)} | ${range(e.mentioned)} | ${range(e.cited)} | ${e.avgPosition ?? "–"} | ${e.positive} / ${e.negative} |`
    );
  }
  push("");

  // Engines
  push("## By engine", "");
  push("| Engine | Answers | Names you | Cites you | Most-named competitor | Questions covered |", "| --- | --- | --- | --- | --- | --- |");
  for (const e of report.engines) {
    const cov = report.coverage.find((c) => c.engine === e.engine);
    push(
      `| ${label(e.engine)} | ${e.answers} | ${range(e.youMentioned)} | ${e.youCited.n ? range(e.youCited) : "sources not shown by this engine"} | ${e.topCompetitor ? `${cell(e.topCompetitor.name)} (${e.topCompetitor.answers})` : "–"} | ${
        cov ? `${cov.promptsCovered} of ${cov.activeUnbrandedPrompts}` : "–"
      } |`
    );
  }
  push("");
  const failing = Object.entries(report.failures.byEngine).filter(([, f]) => f.blocked + f.skipped + f.noAnswer + (f.network || 0) + (f.setup || 0) > 0);
  if (failing.length) {
    push("**Engines that did not answer every question** (recorded as failures, never filled in):", "");
    for (const [engine, f] of failing) {
      const parts = [
        f.blocked && `${f.blocked} blocked by the engine`,
        f.skipped && `${f.skipped} skipped while it kept blocking`,
        f.noAnswer && `${f.noAnswer} without a readable answer`,
        f.network && `${f.network} network errors`,
        f.setup && `${f.setup} not set up`,
      ].filter(Boolean);
      push(`- ${label(engine)}: ${parts.join(", ")}.`);
    }
    push("");
  }
  if (report.aioTrigger.overviews + report.aioTrigger.noOverview > 0) {
    push(`Google showed an AI Overview for ${range(report.aioTrigger.rate)} of the searches it answered.`, "");
  }

  // By buyer stage: the intents the questions were tagged with (branded questions excluded)
  const stages = new Map<string, { questions: number; answers: number; named: number; rivals: Map<string, number> }>();
  for (const p of report.prompts) {
    if (p.branded || !p.active || p.answers === 0) continue;
    const st = stages.get(p.intent) ?? { questions: 0, answers: 0, named: 0, rivals: new Map<string, number>() };
    st.questions++;
    st.answers += p.answers;
    st.named += p.youMentioned;
    for (const c of p.competitors) st.rivals.set(c.name, (st.rivals.get(c.name) || 0) + c.answers);
    stages.set(p.intent, st);
  }
  if (stages.size > 1) {
    push("## By buyer stage", "", "Unbranded questions grouped by the intent they were tagged with.", "");
    push("| Stage (intent) | Questions | Answers naming you | Most-named competitor |", "| --- | --- | --- | --- |");
    for (const [intent, st] of [...stages.entries()].sort((a, b) => b[1].answers - a[1].answers)) {
      const top = [...st.rivals.entries()].sort((a, b) => b[1] - a[1])[0];
      push(
        `| ${cell(intent.replace(/_/g, " "))} | ${st.questions} | ${Math.round((st.named / st.answers) * 100)}% (${st.named} of ${st.answers}) | ${
          top ? `${cell(top[0])} (${top[1]} of ${st.answers})` : "none named"
        } |`
      );
    }
    push("");
  }

  // Where answers come from
  if (report.topSources.length) {
    push("## Sources the engines cite most", "");
    push("| Site | Answers citing it | Type |", "| --- | --- | --- |");
    for (const s of report.topSources) push(`| ${cell(s.domain)} | ${s.answers} | ${s.isBrand ? "Your site" : s.isCompetitor ? "Competitor" : "Third-party"} |`);
    push("");
  }

  // Brand accuracy
  const acc = report.brandAccuracy;
  if (acc.confusedAnswers > 0) {
    push(
      "## Brand accuracy",
      "",
      `${acc.confusedAnswers} of ${acc.answersNamingBrand} answers that name ${brand.name} also point to a look-alike domain (${acc.lookalikeDomains
        .map((d) => `${d.domain} ×${d.answers}`)
        .join(", ")}). Buyers may land on the wrong company.`,
      ""
    );
  }

  // Gaps
  const gaps = findOpportunities(report, brand.name);
  if (gaps.length) {
    push("## Biggest gaps", "", "Unbranded questions where a competitor is named and you are not, most urgent first.", "");
    push("| Question | Named instead | Priority |", "| --- | --- | --- |");
    for (const g of gaps.slice(0, 15)) {
      const comp = g.prompt.competitors[0];
      push(`| ${cell(g.prompt.text)} | ${comp ? `${cell(comp.name)} (${comp.answers} of ${g.prompt.answers})` : "no tracked vendor"} | ${g.priority} |`);
    }
    push("");
    const top = gaps[0];
    if (top?.actions.length) {
      push(`**Recommended next steps for "${cell(top.prompt.text)}":**`, "", ...top.actions.map((a) => `- ${a}`), "");
    }
  }

  // AI Overviews vs Google's organic ranking (same results page)
  const ao = report.aioVsOrganic;
  if (ao && ao.answers > 0) {
    const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
    push(
      "## Google AI Overviews vs organic ranking",
      "",
      `For ${ao.answers} Google searches with an AI Overview, the organic top 10 of the same results page was captured.`,
      "",
      `- ${pctOf(ao.citedInTop10, ao.citedSites)} of the sites the Overviews cite also rank in the organic top 10 (${pctOf(ao.citedInTop3, ao.citedSites)} in the top 3); the rest are cited without ranking there.`,
      `- Your site ranks in the top 10 for ${ao.brand.ranksTop10} of these searches${ao.brand.averagePosition !== null ? ` (average position ${ao.brand.averagePosition})` : ""} and is cited in ${ao.brand.cited} Overviews.`,
      ...(ao.brand.ranksNotCited > 0 ? [`- In ${ao.brand.ranksNotCited} searches you rank in the top 10 but the Overview does not cite you: the closest wins.`] : []),
      ...(ao.citedOutsideTop10.length ? [`- Cited most often without ranking in the top 10: ${ao.citedOutsideTop10.slice(0, 5).map((s) => `${s.domain} (${s.answers})`).join(", ")}.`] : []),
      ""
    );
  }

  // Method
  push(
    "## Method and limits",
    "",
    `- ${report.totalAnswers} answers to ${report.totalQuestions} unbranded questions (${report.allAnswers} stored in total, including branded and paused questions).`,
    "- Each engine was asked the questions as a buyer would type them; only answers the engine actually returned are counted. Blocks, rate limits and missing AI Overviews are recorded as failures with a reason.",
    "- Ranges are 95% intervals that account for repeated answers to the same question. A company named in the question itself is not counted as mentioned for that question.",
    "- Engines answered without a signed-in account unless noted; answers can vary by account, location and time.",
    ...report.localisation.byEngine
      .filter((e) => e.localised > 0)
      .map(
        (e) =>
          `- ${label(e.engine)}: ${e.localised} of ${e.answers} answers were tailored to ${Object.keys(e.places).join(", ")}, where PrismGEO ran, rather than to the markets measured.`
      ),
    ...(meta.competitors?.length ? [`- Tracked competitors: ${meta.competitors.join(", ")}.`] : []),
    ""
  );
  return lines.join("\n");
}
