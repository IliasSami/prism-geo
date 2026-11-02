import crypto from "node:crypto";
import { notifyDesktop } from "../engines/notify";
import { getRawDb } from "@prismgeo/db";
import { clearBrowserCooldown } from "../engines/block-memory";

/**
 * Action requests: steps only a person can take, shown under the bell in the dashboard.
 *
 * When an engine's browser hits a "verify you are human" check or an expired sign-in, PrismGEO
 * does not try to get past it. It holds that engine (the other engines keep running), records the
 * questions it could not ask, and raises one request. The person opens the same saved browser
 * profile in a visible window and completes the step themselves; the held engine then asks the
 * question again and carries on. If nobody comes in time, the questions stay on the request and
 * can be resumed later. Nothing here solves, skips or hides a check.
 */

/** human_check: a "verify you are human" page. sign_in: the engine wants a signed-in account. */
export type ActionKind = "human_check" | "sign_in";
/** open: waiting for the person. ready: done, questions waiting to resume. resolved / dismissed: closed. */
export type ActionStatus = "open" | "ready" | "resolved" | "dismissed";

export interface ActionRequest {
  id: string;
  brandId: string | null;
  batchId: string | null;
  engine: string;
  account: string;
  kind: ActionKind;
  message: string;
  pageUrl: string | null;
  status: ActionStatus;
  pendingPromptIds: string[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** Signals of a check a person can complete in a visible window (never answered automatically). */
const HUMAN_CHECK = /verify you are human|are you a robot|captcha|just a moment|unusual traffic|unusual activity/i;
/** Signals that the engine wants a signed-in account (expired session, or a logged-out wall). */
const SIGNED_OUT = /session (?:has )?expired|signed out|sign in to continue|no chat box|sign up and repeat your request/i;
/** Limits that end by themselves after a while: the engine rests, there is nothing for a person to do. */
const RATE_LIMIT = /usage limit|throttled reply|rate limit|too many requests|\b429\b/i;

/** Where the person completes the step for each engine. */
const PAGE_FOR: Record<string, string> = {
  chatgpt: "https://chatgpt.com/",
  perplexity: "https://www.perplexity.ai/",
  gemini: "https://gemini.google.com/app?hl=en",
  google_aio: "https://www.google.com/",
  copilot: "https://copilot.microsoft.com/",
};

/**
 * Whether a browser failure needs a person, and which kind. Usage and rate limits are not
 * included: they end by themselves after a few hours, so the engine rests instead.
 */
export function needsPerson(message: string): ActionKind | null {
  if (RATE_LIMIT.test(message)) return null;
  if (HUMAN_CHECK.test(message)) return "human_check";
  if (SIGNED_OUT.test(message)) return "sign_in";
  return null;
}

/** The page a person should open to complete a step: the blocked search for Google, else the engine's home. */
export function pageForAction(engine: string, query?: string | null): string {
  if (engine === "google_aio" && query) return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return PAGE_FOR[engine] || "about:blank";
}

const NAMES: Record<string, string> = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", google_aio: "Google", google_ai_mode: "Google", copilot: "Copilot" };
const engineName = (engine: string) => NAMES[engine] || engine;

const KIND_TEXT: Record<ActionKind, (engine: string) => string> = {
  human_check: (engine) =>
    `${engineName(engine)} is asking to confirm a person is there ("verify you are human"). PrismGEO never answers these checks. Open the window, complete the check yourself, then close the window.`,
  sign_in: (engine) => `${engineName(engine)} needs a signed-in account (the saved one is signed out, or none is saved). Open the window, sign in, then close the window.`,
};

interface Row {
  id: string;
  brand_id: string | null;
  batch_id: string | null;
  engine: string;
  account: string;
  kind: string;
  message: string;
  page_url: string | null;
  status: string;
  pending_prompts_json: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function toRequest(r: Row): ActionRequest {
  let pending: string[] = [];
  try {
    const parsed = JSON.parse(r.pending_prompts_json);
    if (Array.isArray(parsed)) pending = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // keep empty
  }
  return {
    id: r.id,
    brandId: r.brand_id,
    batchId: r.batch_id,
    engine: r.engine,
    account: r.account,
    kind: r.kind as ActionKind,
    message: r.message,
    pageUrl: r.page_url,
    status: r.status as ActionStatus,
    pendingPromptIds: pending,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

const now = () => new Date().toISOString();

/**
 * The open request of an engine for one brand (`IS` so a null brand matches a request with none). Keyed
 * by brand too, so one client's audit never takes over, or loses, another client's held questions.
 * With `brandId` undefined, any brand's.
 */
const openRow = (engine: string, brandId?: string | null) =>
  (brandId === undefined
    ? getRawDb().prepare("SELECT * FROM action_requests WHERE engine = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(engine)
    : getRawDb().prepare("SELECT * FROM action_requests WHERE engine = ? AND brand_id IS ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(engine, brandId)) as
    | Row
    | undefined;

/**
 * Raises a request, or adds to the one already open for this engine and brand (one bell entry per
 * thing to do, however many questions are waiting on it). Returns the request.
 */
export function raiseActionRequest(input: {
  brandId: string | null;
  batchId: string | null;
  engine: string;
  /** The profile the window opens: a signed-in account id, or "visitor". */
  account?: string;
  kind: ActionKind;
  detail?: string;
  pageUrl?: string | null;
  promptIds?: string[];
}): ActionRequest {
  const db = getRawDb();
  const account = input.account || "visitor";
  const existing = openRow(input.engine, input.brandId);
  if (existing) {
    // A check still on screen stays the step to take: a sign-in notice never replaces it
    const kind: ActionKind = existing.kind === "human_check" ? "human_check" : input.kind;
    const message = KIND_TEXT[kind](input.engine);
    const pending = [...new Set([...toRequest(existing).pendingPromptIds, ...(input.promptIds || [])])];
    db.prepare(
      "UPDATE action_requests SET kind = ?, message = ?, account = ?, page_url = COALESCE(?, page_url), batch_id = COALESCE(?, batch_id), pending_prompts_json = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?"
    ).run(kind, message, account, input.pageUrl ?? null, input.batchId, JSON.stringify(pending), input.detail?.slice(0, 300) ?? null, now(), existing.id);
    return getActionRequest(existing.id)!;
  }
  const message = KIND_TEXT[input.kind](input.engine);
  const id = `act-${crypto.randomBytes(6).toString("hex")}`;
  db.prepare(
    "INSERT INTO action_requests (id, brand_id, batch_id, engine, account, kind, message, page_url, status, pending_prompts_json, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)"
  ).run(
    id,
    input.brandId,
    input.batchId,
    input.engine,
    account,
    input.kind,
    message,
    input.pageUrl ?? pageForAction(input.engine),
    JSON.stringify([...new Set(input.promptIds || [])]),
    input.detail?.slice(0, 300) ?? null,
    now(),
    now()
  );
  // A new request: tell the person even when the dashboard is closed
  notifyDesktop("PrismGEO needs you", `${engineName(input.engine)}: ${input.kind === "sign_in" ? "sign in" : "complete a \"verify you are human\" check"}. Open the bell in PrismGEO.`);
  return getActionRequest(id)!;
}

/** Adds questions that could not be asked to a request. */
export function addPendingPrompts(id: string, promptIds: string[]): void {
  const row = getActionRequest(id);
  if (!row || !promptIds.length) return;
  const pending = [...new Set([...row.pendingPromptIds, ...promptIds])];
  getRawDb().prepare("UPDATE action_requests SET pending_prompts_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(pending), now(), id);
}

/** Replaces the questions a request holds (those being asked again are taken off it). */
export function setPendingPrompts(id: string, promptIds: string[]): void {
  getRawDb().prepare("UPDATE action_requests SET pending_prompts_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify([...new Set(promptIds)]), now(), id);
}

export function getActionRequest(id: string): ActionRequest | null {
  const row = getRawDb().prepare("SELECT * FROM action_requests WHERE id = ?").get(id) as Row | undefined;
  return row ? toRequest(row) : null;
}

/** Requests still needing attention (open, or done and waiting to resume), newest first. */
export function listActionRequests(opts: { includeClosed?: boolean; limit?: number } = {}): ActionRequest[] {
  const where = opts.includeClosed ? "" : "WHERE status IN ('open', 'ready')";
  return (getRawDb().prepare(`SELECT * FROM action_requests ${where} ORDER BY created_at DESC LIMIT ?`).all(opts.limit ?? 50) as unknown as Row[]).map(toRequest);
}

/**
 * The open request of an engine for a brand (any brand when `brandId` is omitted): its browser
 * route waits for the person until it is done.
 */
export function openActionFor(engine: string, brandId?: string | null): ActionRequest | null {
  const row = openRow(engine, brandId);
  return row ? toRequest(row) : null;
}

export function setActionStatus(id: string, status: ActionStatus, note?: string): ActionRequest | null {
  const closed = status === "resolved" || status === "dismissed";
  const at = now();
  getRawDb()
    .prepare("UPDATE action_requests SET status = ?, note = COALESCE(?, note), updated_at = ?, resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END WHERE id = ?")
    .run(status, note ?? null, at, closed ? 1 : 0, at, id);
  return getActionRequest(id);
}

/**
 * The person completed the step: the request is ready to resume, and the browser route's rest
 * period (recorded when nobody came in time) ends, since the check it was waiting out is gone.
 */
export function markActionDone(id: string, note?: string): ActionRequest | null {
  const request = getActionRequest(id);
  if (!request || request.status === "resolved" || request.status === "dismissed") return request;
  clearBrowserCooldown(request.engine);
  // Nothing held: there is nothing to resume, so it is closed
  return setActionStatus(id, request.pendingPromptIds.length ? "ready" : "resolved", note);
}

/**
 * How long an audit holds an engine for a person before moving on: 15 minutes, or
 * PRISMGEO_PERSON_WAIT_MIN (0: never wait). Questions not asked by then stay on the request.
 */
export function personWaitMs(): number {
  const raw = process.env.PRISMGEO_PERSON_WAIT_MIN;
  const minutes = raw === undefined || raw === "" ? NaN : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 15) * 60_000;
}

/**
 * Waits until the person has completed the request ("ready" or "resolved": true) or dismissed it
 * (false), for at most `ms`. While a window is still open for the engine it is not done yet: the
 * crawler cannot use a profile that window holds.
 */
export async function waitForPerson(id: string, ms: number, opts: { pollMs?: number; windowOpen?: () => boolean } = {}): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    const status = getActionRequest(id)?.status;
    if (!status || status === "dismissed") return false;
    if ((status === "ready" || status === "resolved") && !opts.windowOpen?.()) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, Math.min(opts.pollMs ?? 2000, until - Date.now())));
  }
}
