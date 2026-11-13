export class ApiError extends Error {
  constructor(message, { status = 0, outcomeUnknown = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

// Mutating requests are never retried: a lost response can still mean a payment ran.
export async function requestJson(path, { body, timeoutMs = 12_000, cache = "no-store" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const mutating = body !== undefined;
  try {
    const response = await fetch(path, {
      method: mutating ? "POST" : "GET",
      headers: { Accept: "application/json", ...(mutating ? { "Content-Type": "application/json" } : {}) },
      ...(mutating ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      credentials: "same-origin",
      cache,
    });
    let payload;
    try { payload = await response.json(); }
    catch {
      throw new ApiError("The server returned an unreadable response. Reconnect to refresh the results.", {
        status: response.status, outcomeUnknown: mutating,
      });
    }
    if (!response.ok) {
      throw new ApiError(payload.error ?? "The request failed. Please try again.", {
        status: response.status, outcomeUnknown: mutating && response.status >= 500,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error.name === "AbortError"
      ? mutating
        ? "The request timed out and may still be running. Reconnect to refresh receipts before submitting again."
        : "The connection timed out. Check your connection and try again."
      : mutating
        ? "The connection was interrupted. The request may have run. Reconnect to refresh receipts before submitting again."
        : "Unable to connect. Check your connection and try again.";
    throw new ApiError(message, { outcomeUnknown: mutating });
  } finally {
    clearTimeout(timer);
  }
}

export function createLiveRuntime() {
  return {
    recorded: false,
    status: () => requestJson("./api/status"),
    scenarios: () => requestJson("./api/scenarios"),
    run: (id) => requestJson("./api/run", { body: { scenario_id: id }, timeoutMs: 120_000 }),
    reset: () => requestJson("./api/reset", { body: {}, timeoutMs: 120_000 }),
    report: () => requestJson("./api/report"),
  };
}
