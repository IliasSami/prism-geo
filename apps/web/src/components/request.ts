/**
 * Client-side requests. A request that never reached the server (PrismGEO stopped, network gone)
 * throws OfflineError, so callers can say so and skip anything that needs the server, such as
 * router.refresh(): refreshing while the server is down ends on the browser's own error page.
 */
export const NOT_RUNNING = "PrismGEO did not answer. Is it running?";

export class OfflineError extends Error {
  constructor(message = NOT_RUNNING) {
    super(message);
    this.name = "OfflineError";
  }
}

/** fetch() that turns a network failure into OfflineError; any HTTP answer is returned as is. */
export async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new OfflineError();
  }
}
