import { describe, expect, it } from "vitest";
import {
  E2E_HARNESS_CLOCK_FUTURE_TOLERANCE_MS,
  E2E_HARNESS_GUARD_FAILURE_RESPONSE,
  E2E_HARNESS_REPLAY_MAX_JSON_BYTES,
  guardE2EHarnessReplayRequest,
  parseE2EHarnessReplayBody,
} from "~/lib/e2e-harness-guard.server";

const now = new Date("2026-07-15T12:00:00.000Z");
const body = {
  userId: "e2e-starter",
  runId: "e2e-run-starter-1",
  idempotencyKey: "e2e-test-key",
  scenario: "j3",
  clock: now.toISOString(),
} as const;

function request(
  value: unknown = body,
  init: { url?: string; method?: string; headers?: Record<string, string> } = {},
) {
  return new Request(init.url ?? "http://127.0.0.1:43127/api/e2e/harness", {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-0509-e2e-test-mode": "1",
      cookie: "f9_e2e_fixture=e2e-starter",
      ...init.headers,
    },
    body: JSON.stringify(value),
  });
}

const decisions = {
  networkDeny: { enabled: true, failClosed: true },
  testMode: { enabled: true, sentinel: true },
  now,
};

describe("E2E harness replay guard", () => {
  it("returns only allowlisted metadata for a fully verified local request", async () => {
    await expect(guardE2EHarnessReplayRequest(request(), decisions)).resolves.toEqual({
      ok: true,
      metadata: { ...body, origin: "http://127.0.0.1:43127" },
    });
  });

  it("accepts the pure body parser only when the cookie identity matches", () => {
    expect(parseE2EHarnessReplayBody(body, { cookieUserId: body.userId, now })).toEqual({
      ok: true,
      metadata: { ...body, origin: "" },
    });
    expect(parseE2EHarnessReplayBody(body, { cookieUserId: "e2e-other", now })).toMatchObject({
      ok: false,
      reason: "user_id",
    });
  });

  it.each([
    ["remote origin", { url: "https://0509.io/api/e2e/replay" }, "origin"],
    ["https origin", { url: "https://127.0.0.1:43127/api/e2e/replay" }, "origin"],
    ["missing port", { url: "http://127.0.0.1/api/e2e/replay" }, "origin"],
    ["privileged port", { url: "http://127.0.0.1:80/api/e2e/replay" }, "origin"],
    ["loopback alias", { url: "http://localhost:43127/api/e2e/replay" }, "origin"],
    ["non-POST method", { method: "PUT" }, "method"],
    ["non-JSON content type", { headers: { "content-type": "text/plain" } }, "content_type"],
    ["missing marker", { headers: { "x-0509-e2e-test-mode": "0" } }, "test_mode_header"],
    ["missing fixture cookie", { headers: { cookie: "" } }, "fixture_cookie"],
  ] as const)("rejects %s before parsing or replay", async (_label, init, reason) => {
    await expect(guardE2EHarnessReplayRequest(request(body, init), decisions)).resolves.toMatchObject({
      ok: false,
      reason,
      response: E2E_HARNESS_GUARD_FAILURE_RESPONSE,
    });
  });

  it.each([
    ["network deny not enabled", { networkDeny: { enabled: false, failClosed: true } }, "network_deny"],
    ["network deny not fail closed", { networkDeny: { enabled: true, failClosed: false } }, "network_deny"],
    ["test mode not enabled", { testMode: { enabled: false, sentinel: true } }, "test_mode_decision"],
    ["sentinel not verified", { testMode: { enabled: true, sentinel: false } }, "test_mode_decision"],
  ] as const)("requires an explicit %s decision", async (_label, override, reason) => {
    await expect(guardE2EHarnessReplayRequest(request(), { ...decisions, ...override })).resolves.toMatchObject({
      ok: false,
      reason,
    });
  });

  it("rejects malformed, oversized, and non-JSON request bodies", async () => {
    const malformed = new Request("http://127.0.0.1:43127/api/e2e/harness", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-0509-e2e-test-mode": "1",
        cookie: "f9_e2e_fixture=e2e-starter",
      },
      body: "{not-json",
    });
    await expect(guardE2EHarnessReplayRequest(malformed, decisions)).resolves.toMatchObject({ ok: false, reason: "body_json" });

    const oversized = request({ ...body, runId: `e2e-${"x".repeat(E2E_HARNESS_REPLAY_MAX_JSON_BYTES)}` });
    await expect(guardE2EHarnessReplayRequest(oversized, decisions)).resolves.toMatchObject({ ok: false, reason: "body_too_large" });
  });

  it.each([
    ["unknown field", { extra: "nope" }, "unknown_fields"],
    ["missing field", (() => { const value = { ...body }; delete (value as { clock?: string }).clock; return value; })(), "unknown_fields"],
    ["cookie mismatch", { ...body, userId: "e2e-agency" }, "user_id"],
    ["invalid user id", { ...body, userId: "user-1" }, "user_id"],
    ["invalid run id", { ...body, runId: "run-1" }, "run_id"],
    ["invalid idempotency key", { ...body, idempotencyKey: "idem-1" }, "idempotency_key"],
    ["invalid scenario", { ...body, scenario: "j2" }, "scenario"],
    ["invalid clock", { ...body, clock: "2026-07-15T12:00:00Z" }, "clock"],
    ["future clock", { ...body, clock: new Date(now.getTime() + E2E_HARNESS_CLOCK_FUTURE_TOLERANCE_MS + 1).toISOString() }, "clock"],
  ] as const)("rejects %s", async (_label, value, reason) => {
    await expect(guardE2EHarnessReplayRequest(request(value), decisions)).resolves.toMatchObject({ ok: false, reason });
  });

  it("accepts every supported scenario and rejects cookie identity variants", async () => {
    for (const scenario of ["j3", "j4", "j5", "j6"] as const) {
      await expect(guardE2EHarnessReplayRequest(request({ ...body, scenario }), decisions)).resolves.toMatchObject({
        ok: true,
        metadata: { scenario },
      });
    }
    await expect(guardE2EHarnessReplayRequest(
      request(body, { headers: { cookie: "f9_e2e_fixture=e2e-starter; f9_e2e_fixture=e2e-starter" } }),
      decisions,
    )).resolves.toMatchObject({ ok: false, reason: "fixture_cookie" });
  });
});
