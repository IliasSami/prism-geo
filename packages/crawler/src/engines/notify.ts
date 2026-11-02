import { spawn } from "node:child_process";
import { getSettings } from "@prismgeo/db";
import { canShowWindow } from "./check-window";

/**
 * A desktop notification on the computer running PrismGEO (macOS Notification Center, Linux
 * notify-send), so a person hears about a human check or a finished audit without the dashboard
 * open. Best effort: nothing happens on Windows, servers without a screen, or when switched off
 * (Settings → Schedule, `desktopNotifications: false`).
 */
export function notifyDesktop(title: string, body: string): void {
  try {
    // Never from test runs (node --test sets NODE_TEST_CONTEXT), or when switched off by environment
    if (process.env.NODE_TEST_CONTEXT || process.env.PRISMGEO_NO_NOTIFY === "1") return;
    if (!canShowWindow() || getSettings<{ desktopNotifications?: boolean }>("crawler_settings", {}).desktopNotifications === false) return;
    const clean = (s: string) => s.replace(/["\\]/g, "'").slice(0, 220);
    const child =
      process.platform === "darwin"
        ? spawn("osascript", ["-e", `display notification "${clean(body)}" with title "${clean(title)}" sound name "Glass"`], { stdio: "ignore" })
        : process.platform === "linux"
          ? spawn("notify-send", ["--app-name=PrismGEO", title, body], { stdio: "ignore" })
          : null;
    child?.on("error", () => undefined);
    child?.unref();
  } catch {
    // a notification must never break an audit
  }
}
