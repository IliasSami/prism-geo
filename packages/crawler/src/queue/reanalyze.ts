import { getRawDb, nowIso, rowToBrand } from "@prismgeo/db";
import { detectMentions, lookalikeDomains, prominenceScore, stanceOf } from "@prismgeo/core";
import crypto from "node:crypto";
import { trackedEntitiesFor } from "./manual-capture";

export interface ReanalyzeResult {
  runs: number;
  mentionsBefore: number;
  mentionsAfter: number;
  /** Runs whose set of named companies or their tone changed. */
  runsChanged: number;
}

/**
 * Re-derives entity mentions (who is named, where, with which tone, prompt echoes and brand
 * look-alikes) for every stored answer of a brand, from the answer text that was actually
 * captured, with the current detection rules and the current competitor list and aliases.
 * Answers, citations and passages are untouched; nothing is estimated. Runs in one transaction
 * and refuses to run while an audit for the brand is writing.
 */
export function reanalyzeBrand(brandId: string): ReanalyzeResult {
  const sqlite = getRawDb();
  const brandRow = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
  if (!brandRow) throw new Error(`Brand ${brandId} not found`);
  if (sqlite.prepare("SELECT 1 FROM crawl_batches WHERE brand_id = ? AND status = 'running' LIMIT 1").get(brandId)) {
    throw new Error("An audit is running for this client; re-check past answers after it finishes");
  }
  const brand = rowToBrand(brandRow as Record<string, unknown>);
  const { entities } = trackedEntitiesFor(brand);

  const runs = sqlite
    .prepare(
      `SELECT r.id, r.response_text, r.flags_json, p.query_text FROM prompt_runs r JOIN prompts p ON p.id = r.prompt_id WHERE r.brand_id = ?`
    )
    .all(brandId) as Array<{ id: string; response_text: string; flags_json: string | null; query_text: string }>;
  const citationsOf = sqlite.prepare("SELECT domain FROM citations WHERE run_id = ?");
  const mentionsOf = sqlite.prepare("SELECT entity_name, sentiment FROM entity_mentions WHERE run_id = ? ORDER BY entity_name");
  const deleteMentions = sqlite.prepare("DELETE FROM entity_mentions WHERE run_id = ?");
  const insertMention = sqlite.prepare(
    `INSERT INTO entity_mentions (id, brand_id, run_id, competitor_id, entity_name, is_target_brand, is_competitor, is_prompt_subject, sentiment, stance, has_caveat,
       prominence_score, position_rank, list_position, entity_confusion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateFlags = sqlite.prepare("UPDATE prompt_runs SET flags_json = ? WHERE id = ?");
  const brandDomain = brand.domain;
  const result: ReanalyzeResult = { runs: runs.length, mentionsBefore: 0, mentionsAfter: 0, runsChanged: 0 };
  const signature = (rows: Array<{ entity_name: string; sentiment: string }>) => rows.map((r) => `${r.entity_name}:${r.sentiment}`).sort().join("|");

  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const createdAt = nowIso();
    for (const run of runs) {
      const before = mentionsOf.all(run.id) as Array<{ entity_name: string; sentiment: string }>;
      result.mentionsBefore += before.length;
      const domains = (citationsOf.all(run.id) as Array<{ domain: string }>).map((c) => c.domain);
      const { prose, mentions } = detectMentions(run.response_text, entities, run.query_text);
      const allStarts = mentions.flatMap((m) => m.hits.map((h) => h.index));
      const lookalikes = lookalikeDomains(run.response_text, domains, brandDomain);

      let flags: Record<string, unknown> = {};
      try {
        flags = JSON.parse(run.flags_json || "{}");
      } catch {}
      if (lookalikes.length) flags.entityConfusion = { lookalikeDomains: lookalikes };
      else delete flags.entityConfusion;
      updateFlags.run(JSON.stringify(flags), run.id);

      deleteMentions.run(run.id);
      const after: Array<{ entity_name: string; sentiment: string }> = [];
      for (const m of mentions) {
        const stance = stanceOf(prose, m.hits, allStarts);
        insertMention.run(
          `ent-${crypto.randomBytes(6).toString("hex")}`,
          brandId,
          run.id,
          m.entity.competitorId,
          m.entity.name,
          m.entity.isTarget ? 1 : 0,
          m.entity.isTarget ? 0 : 1,
          m.isPromptSubject ? 1 : 0,
          stance.sentiment,
          stance.stance,
          stance.hasCaveat ? 1 : 0,
          prominenceScore(m.hits[0].index, prose.length, m.listPosition),
          m.positionRank,
          m.listPosition,
          m.entity.isTarget && lookalikes.length > 0 ? 1 : 0,
          createdAt
        );
        after.push({ entity_name: m.entity.name, sentiment: stance.sentiment });
      }
      result.mentionsAfter += after.length;
      if (signature(before) !== signature(after)) result.runsChanged++;
    }
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  console.log(
    `[Reanalyze] ${brand.name}: ${result.runs} answers re-checked, ${result.runsChanged} changed, mentions ${result.mentionsBefore} -> ${result.mentionsAfter}`
  );
  return result;
}
