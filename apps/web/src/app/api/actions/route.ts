import { NextResponse } from "next/server";
import { getRawDb } from "@prismgeo/db";
import { ENGINES, type EngineId } from "@prismgeo/core";
import {
  canShowWindow,
  checkWindowState,
  closeCheckWindow,
  getActionRequest,
  getProfileStatuses,
  listActionRequests,
  markActionDone,
  openCheckWindow,
  openSignInWindow,
  setActionStatus,
  setPendingPrompts,
  DEFAULT_ACCOUNT,
  PROFILE_ENGINES,
  type ActionRequest,
  type ProfileEngine,
} from "@prismgeo/crawler";
import { jsonError, readJsonObject, route } from "../_lib/http";
import { findBrand } from "../_lib/brand";
import { startCrawl } from "../_lib/crawl";

export const dynamic = "force-dynamic";

const isProfileEngine = (e: string): e is ProfileEngine => (PROFILE_ENGINES as string[]).includes(e);
/** The saved account a sign-in window opens ("visitor" requests sign in to the default account). */
const signInAccount = (r: ActionRequest) => (r.account === "visitor" ? DEFAULT_ACCOUNT : r.account);

/** Whether a window for the request is open, and (for a check) whether the check is gone from it. */
function windowOf(r: ActionRequest): { open: boolean; cleared: boolean } {
  if (r.kind === "human_check") return checkWindowState(r.engine);
  const s = getProfileStatuses().find((p) => p.engine === r.engine && p.account === signInAccount(r));
  return { open: s?.connecting === true, cleared: s?.signedInDetected === true };
}

/** Requests needing a person (the bell), with what the dashboard shows for each. */
export const GET = route("actions GET", async () => {
  const sqlite = getRawDb();
  const promptText = sqlite.prepare("SELECT query_text FROM prompts WHERE id = ?");
  const batchState = sqlite.prepare("SELECT status FROM crawl_batches WHERE id = ?");
  const brandName = sqlite.prepare("SELECT name FROM brands WHERE id = ?");
  const actions = listActionRequests().map((r) => ({
    ...r,
    engineLabel: ENGINES[r.engine as EngineId]?.label || r.engine,
    brandName: r.brandId ? ((brandName.get(r.brandId) as { name: string } | undefined)?.name ?? null) : null,
    // An audit is holding the engine for this request right now: done is enough, no resume needed
    auditWaiting: Boolean(r.batchId) && (batchState.get(r.batchId!) as { status: string } | undefined)?.status === "running",
    questions: r.pendingPromptIds
      .slice(0, 5)
      .map((id) => (promptText.get(id) as { query_text: string } | undefined)?.query_text)
      .filter((q): q is string => Boolean(q)),
    window: windowOf(r),
  }));
  return NextResponse.json({ actions, canOpenWindow: canShowWindow() });
});

/**
 * { id, action }:
 * - "open": opens a visible window on the engine's saved browser profile where the person completes
 *   the check or signs in themselves. Returns at once; when the window closes with the check gone
 *   (or signed in), the request is marked done. 501 when this server has no screen.
 * - "done": the person says it is completed (closes the window if one is open).
 * - "dismiss": nobody will do it; a waiting audit stops holding the engine.
 * - "resume": asks the questions the request held again, in a new audit of those questions only.
 */
export const POST = route("actions POST", async (request: Request) => {
  const body = await readJsonObject(request);
  const id = typeof body?.id === "string" ? body.id : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const r = id ? getActionRequest(id) : null;
  if (!r) return jsonError("No such request", 404);
  if (r.status === "resolved" || r.status === "dismissed") return jsonError("This request is already closed", 409);

  if (action === "open") {
    if (!isProfileEngine(r.engine)) return jsonError(`${r.engine} has no browser window to open`, 400);
    if (!canShowWindow()) {
      return jsonError(
        "This server has no screen to open a window on (a headless server or Docker). Complete the step on a computer running PrismGEO with a display, or add an API key for this engine.",
        501
      );
    }
    if (windowOf(r).open) return jsonError("The window is already open", 409);
    const engine = r.engine;
    if (r.kind === "sign_in") {
      openSignInWindow(engine, signInAccount(r))
        .then(({ signedIn }) => signedIn && markActionDone(r.id, "Signed in through the window"))
        .catch((err) => console.error(`[Actions] ${engine} sign-in window failed:`, err));
    } else {
      openCheckWindow(engine, r.pageUrl || "about:blank")
        .then(({ cleared }) => (cleared ? markActionDone(r.id, "Check completed in the window") : setActionStatus(r.id, r.status, "The window was closed while the check was still shown")))
        .catch((err) => console.error(`[Actions] ${engine} check window failed:`, err));
    }
    return NextResponse.json({ success: true, status: "window_opened" });
  }

  if (action === "done") {
    // The session is saved when the sign-in window closes; until then the crawler cannot use it
    if (r.kind === "sign_in" && windowOf(r).open) return jsonError("Close the sign-in window first; the session is saved when it closes", 409);
    if (r.kind === "human_check") await closeCheckWindow(r.engine);
    return NextResponse.json({ success: true, action: markActionDone(r.id, "Marked done by the person") });
  }

  if (action === "dismiss") {
    if (r.kind === "human_check") await closeCheckWindow(r.engine);
    return NextResponse.json({ success: true, action: setActionStatus(r.id, "dismissed") });
  }

  if (action === "resume") {
    if (r.status !== "ready") return jsonError("Complete the step first", 409);
    const brand = r.brandId ? findBrand(r.brandId) : undefined;
    // Questions deleted or paused since then are not asked
    const active = getRawDb().prepare("SELECT 1 FROM prompts WHERE id = ? AND active = 1");
    const questions = r.pendingPromptIds.filter((p) => active.get(p));
    if (!brand || !questions.length) {
      setActionStatus(r.id, "resolved", "Nothing left to ask");
      return NextResponse.json({ success: true, batchId: null });
    }
    const started = startCrawl(brand, { engines: [r.engine] }, { promptIdsByEngine: { [r.engine as EngineId]: questions } });
    if (!started.ok) return NextResponse.json(started.body, { status: started.status });
    setPendingPrompts(r.id, []);
    setActionStatus(r.id, "resolved", `Resumed in ${started.body.batchId}`);
    return NextResponse.json({ success: true, batchId: started.body.batchId });
  }

  return jsonError('Use action "open", "done", "dismiss" or "resume"', 400);
});
