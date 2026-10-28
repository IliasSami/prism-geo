/** Server start hook: persistent logging and the rolling daily audit scheduler (Node.js runtime). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installFileLogging } = await import("@prismgeo/db");
    installFileLogging("server");
    const { startScheduler } = await import("@prismgeo/crawler");
    startScheduler();
  }
}
