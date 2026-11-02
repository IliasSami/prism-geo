import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, setSettings } from "@prismgeo/db";
import { getAutopilotState, refreshSerpApiQuota, serpApiBudgetState, type AutopilotSettings } from "@prismgeo/crawler";
import { parseBody, route } from "../_lib/http";

export const dynamic = "force-dynamic";

/** Autopilot status: on/off, what it is doing, each engine's gaps and limits, the SerpApi plan's share. */
export const GET = route("autopilot GET", async () => {
  const settings = getSettings<AutopilotSettings>("autopilot", {});
  const keys = getSettings<{ serpapi?: string }>("byok_api_keys", {});
  // Free and cached for 10 minutes: shows the real plan, not a stale count
  if (keys.serpapi) await refreshSerpApiQuota(keys.serpapi);
  return NextResponse.json({
    enabled: settings.enabled === true,
    state: getAutopilotState(),
    serpapi: keys.serpapi ? serpApiBudgetState() : null,
  });
});

const bodySchema = z.object({ enabled: z.boolean({ error: "enabled must be true or false" }) });

/** { enabled }: turns the autopilot on or off. It starts its first step within a few minutes. */
export const POST = route("autopilot POST", async (request: Request) => {
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  setSettings("autopilot", { ...getSettings<AutopilotSettings>("autopilot", {}), enabled: parsed.data.enabled });
  return NextResponse.json({ success: true, enabled: parsed.data.enabled, state: getAutopilotState() });
});
