import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  description: text("description"),
  aliasesJson: text("aliases_json").notNull().default("[]"), // Array of aliases e.g. ["Ilias Ahmed", "Scrawly"]
  valuePropsJson: text("value_props_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const competitors = sqliteTable("competitors", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  queryText: text("query_text").notNull(),
  intentType: text("intent_type").notNull(), // 'dilemma' | 'risk' | 'pricing' | 'comparison' | 'direct' | 'category'
  personaDimension: text("persona_dimension").notNull().default("agency_executive"), // 'agency_executive' | 'buyer' | 'technical'
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crawlBatches = sqliteTable("crawl_batches", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  status: text("status").notNull().default("pending"), // 'pending' | 'running' | 'completed' | 'failed'
  sampleSize: integer("sample_size").notNull().default(10), // Monte Carlo sample size N
  totalRuns: integer("total_runs").notNull().default(0),
  completedRuns: integer("completed_runs").notNull().default(0),
  currentPrompt: text("current_prompt"),
  currentEngine: text("current_engine"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
});

export const promptRuns = sqliteTable("prompt_runs", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").references(() => brands.id),
  batchId: text("batch_id").notNull().references(() => crawlBatches.id),
  promptId: text("prompt_id").notNull().references(() => prompts.id),
  engine: text("engine").notNull(), // 'perplexity' | 'google_aio' | 'chatgpt' | 'claude' | 'gemini' | 'copilot'
  runIndex: integer("run_index").notNull(), // 0 to N-1
  responseText: text("response_text").notNull(),
  subQueriesJson: text("sub_queries_json").notNull().default("[]"), // Decomposed queries intercepted from RAG
  promptTokens: integer("prompt_tokens"),
  executionMs: integer("execution_ms").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const citations = sqliteTable("citations", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").references(() => brands.id),
  runId: text("run_id").notNull().references(() => promptRuns.id),
  domain: text("domain").notNull(),
  url: text("url").notNull(),
  title: text("title"),
  snippet: text("snippet"),
  anchorText: text("anchor_text"),
  rank: integer("rank").notNull().default(1),
  isBrandDomain: integer("is_brand_domain", { mode: "boolean" }).notNull().default(false),
  isCompetitorDomain: integer("is_competitor_domain", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const entityMentions = sqliteTable("entity_mentions", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").references(() => brands.id),
  runId: text("run_id").notNull().references(() => promptRuns.id),
  entityName: text("entity_name").notNull(),
  isTargetBrand: integer("is_target_brand", { mode: "boolean" }).notNull().default(false),
  isCompetitor: integer("is_competitor", { mode: "boolean" }).notNull().default(false),
  sentiment: text("sentiment").notNull().default("neutral"), // 'positive' | 'neutral' | 'negative'
  prominenceScore: real("prominence_score").notNull().default(0.0), // 0.0 to 1.0 (token position & frequency)
  positionRank: integer("position_rank").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reverseRagChunks = sqliteTable("reverse_rag_chunks", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").references(() => brands.id),
  runId: text("run_id").notNull().references(() => promptRuns.id),
  citationId: text("citation_id").references(() => citations.id),
  sourceUrl: text("source_url").notNull(),
  matchedChunkText: text("matched_chunk_text").notNull(),
  similarityScore: real("similarity_score").notNull().default(0.0),
  selfContainedScore: real("self_contained_score").notNull().default(0.0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  title: text("title").notNull(),
  subQueryTarget: text("sub_query_target").notNull(),
  gapType: text("gap_type").notNull(), // 'missing_answer_block' | 'unclaimed_subquery' | 'competitor_monopoly' | 'negative_sentiment'
  recommendedAction: text("recommended_action").notNull(),
  estimatedImpact: text("estimated_impact").notNull(), // 'high' | 'medium' | 'low'
  status: text("status").notNull().default("open"), // 'open' | 'in_progress' | 'resolved'
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
