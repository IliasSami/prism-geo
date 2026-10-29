import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

/**
 * Guarded read-only SQL for the MCP query_database tool.
 *
 * - One statement only, starting with SELECT or WITH (checked by a tokenizer that understands
 *   strings, quoted identifiers and comments, so "SELECT 1; DELETE ..." is refused, not truncated).
 * - Secrets: system_settings holds the API keys, the proxy password and the connector token. The
 *   query is compiled with EXPLAIN and refused if its program opens any b-tree of that table or
 *   its index, whatever the spelling (views, aliases, quoting, comments, subqueries). This is
 *   the same decision an SQLite authorizer would make, taken on the compiled program.
 * - Resources: the query runs in a worker thread on its own read-only connection, stops at
 *   MAX_ROWS rows, and is abandoned after the time budget, so a runaway query never blocks the
 *   web server's event loop.
 */

export const MAX_ROWS = 500;
export const TIME_BUDGET_MS = 5_000;
const MAX_SQL_LENGTH = 20_000;
const MAX_LIVE_WORKERS = 2;
const PROTECTED_TABLES = ["system_settings"];

type Token = { kind: "word" | "semicolon" | "other"; text: string };

/** Splits SQL into words and semicolons, skipping strings, quoted identifiers and comments. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      for (;;) {
        const k = sql.indexOf(close, j);
        if (k === -1) {
          j = sql.length;
          break;
        }
        // A doubled quote is an escaped quote inside the literal
        if (close !== "]" && sql[k + 1] === close) {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      tokens.push({ kind: "other", text: sql.slice(i, j) });
      i = j;
    } else if (ch === ";") {
      tokens.push({ kind: "semicolon", text: ";" });
      i++;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      tokens.push({ kind: "word", text: sql.slice(i, j) });
      i = j;
    } else {
      tokens.push({ kind: "other", text: ch });
      i++;
    }
  }
  return tokens;
}

/** Why the SQL is refused before it is compiled, or null when its shape is acceptable. */
export function checkSqlShape(sql: string): string | null {
  if (sql.length > MAX_SQL_LENGTH) return `The query is longer than ${MAX_SQL_LENGTH} characters`;
  const tokens = tokenize(sql);
  const first = tokens[0];
  if (!first || first.kind !== "word" || !/^(select|with)$/i.test(first.text)) return "Only SELECT / WITH queries are allowed";
  const semicolon = tokens.findIndex((t) => t.kind === "semicolon");
  if (semicolon !== -1 && tokens.slice(semicolon + 1).some((t) => t.kind !== "semicolon")) {
    return "Send one statement at a time (found more after a semicolon)";
  }
  return null;
}

/** Root pages of the protected tables and their indexes in the main database. */
function protectedPages(db: DatabaseSync): Set<number> {
  const placeholders = PROTECTED_TABLES.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT rootpage FROM sqlite_master WHERE tbl_name IN (${placeholders}) AND rootpage > 0`).all(...PROTECTED_TABLES) as Array<{
    rootpage: number;
  }>;
  return new Set(rows.map((r) => Number(r.rootpage)));
}

/** True when the compiled query would read a protected table (directly, through a view or a subquery). */
export function readsProtectedTable(db: DatabaseSync, sql: string): boolean {
  const pages = protectedPages(db);
  const program = db.prepare(`EXPLAIN ${sql}`).all() as Array<{ opcode: string; p2: number; p3: number }>;
  return program.some((op) => /^(OpenRead|OpenWrite|ReopenIdx)$/.test(op.opcode) && Number(op.p3) === 0 && pages.has(Number(op.p2)));
}

export type QueryResult =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean; timedOut: boolean; elapsedMs: number }
  | { ok: false; error: string };

// Plain CommonJS for the worker: evaluated from a string, so it works the same under tsx and bundlers
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { dbPath, sql, maxRows, budgetMs } = workerData;
const started = Date.now();
try {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA query_only = 1");
  const rows = [];
  let truncated = false;
  let timedOut = false;
  // Keep the statement referenced for the whole loop: on Node 22.13 an unreferenced statement can
  // be garbage-collected mid-iteration ("statement has been finalized")
  const stmt = db.prepare(sql);
  for (const row of stmt.iterate()) {
    if (rows.length >= maxRows) { truncated = true; break; }
    rows.push(row);
    if (Date.now() - started > budgetMs) { timedOut = true; break; }
  }
  void stmt;
  db.close();
  parentPort.postMessage({ ok: true, rows, truncated, timedOut, elapsedMs: Date.now() - started });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
`;

let liveWorkers = 0;

/**
 * Runs a read-only query with the guards above. `db` is a read-only connection used only to
 * compile the query for the secrets check; the rows are produced in a worker.
 */
export async function runGuardedQuery(
  db: DatabaseSync,
  dbPath: string,
  sql: string,
  { maxRows = MAX_ROWS, budgetMs = TIME_BUDGET_MS } = {},
): Promise<QueryResult> {
  const shape = checkSqlShape(sql);
  if (shape) return { ok: false, error: shape };
  try {
    if (readsProtectedTable(db, sql)) return { ok: false, error: "system_settings holds API keys and the connector token, so it cannot be queried" };
  } catch (err) {
    return { ok: false, error: `SQL error: ${(err as Error).message}` };
  }
  if (liveWorkers >= MAX_LIVE_WORKERS) return { ok: false, error: "Earlier queries are still running. Try again shortly, with a LIMIT." };

  liveWorkers++;
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { dbPath, sql, maxRows, budgetMs } });
  worker.once("exit", () => liveWorkers--);
  return new Promise<QueryResult>((resolve) => {
    // The row loop checks the budget between rows; this catches a single slow step (a big sort or join)
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ ok: false, error: `The query took longer than ${Math.round(budgetMs / 1000)} s and was stopped. Add a LIMIT or a narrower WHERE.` });
    }, budgetMs + 1_000);
    worker.once("message", (msg: QueryResult) => {
      clearTimeout(timer);
      resolve(msg.ok ? { ...msg, rowCount: msg.rows.length } : { ok: false, error: `SQL error: ${msg.error}` });
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `SQL error: ${err.message}` });
    });
  });
}
