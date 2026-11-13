import test from "node:test";
import assert from "node:assert/strict";
import { requestJson, ApiError } from "../src/api.js";

test("an interrupted payment request is never retried and requires receipt reconciliation", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", (_path, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  await assert.rejects(requestJson("/api/run", { body: { scenario_id: "routine" }, timeoutMs: 10 }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.message, /may still be running/);
    return true;
  });
  assert.equal(calls, 1);
});

test("a read timeout is recoverable without implying a payment occurred", async (context) => {
  context.mock.method(globalThis, "fetch", (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  await assert.rejects(requestJson("/api/status", { timeoutMs: 10 }), (error) => {
    assert.equal(error.outcomeUnknown, false);
    assert.match(error.message, /connection timed out/);
    return true;
  });
});

test("an unreadable payment response requires reconciliation instead of resubmission", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls += 1; return new Response("<html>proxy error</html>", { status: 200 }); });
  await assert.rejects(requestJson("/api/run", { body: { scenario_id: "routine" } }), (error) => {
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.message, /unreadable response/);
    return true;
  });
  assert.equal(calls, 1);
});

test("validation refusals retain their error and do not imply an unknown settlement", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ error: "Choose an available scenario." }, { status: 400 }));
  await assert.rejects(requestJson("/api/run", { body: { scenario_id: "unknown" } }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.outcomeUnknown, false);
    assert.equal(error.message, "Choose an available scenario.");
    return true;
  });
});
