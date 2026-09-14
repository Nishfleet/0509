import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #3177 review fix — the first-touch cookie is unsigned, so a planted
 * or stale value must never reach the public time-to-first-confirm p95.
 * The confirm leg bounds the measured delta by the cookie's own Max-Age
 * (1 h): anything beyond it is recorded as a confirm event with no latency
 * sample, never a fabricated number.
 */

const recordJoinConfirmSample = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const resolveJoinIdentity = vi.fn<(...args: unknown[]) => Promise<unknown>>();

async function importAction() {
  vi.resetModules();
  vi.doMock("~/lib/context.server", () => ({ getEnv: () => ({}) }));
  vi.doMock("~/lib/auth.server", () => ({ getOptionalSession: vi.fn().mockResolvedValue(null) }));
  vi.doMock("~/lib/join-identity.server", () => ({
    JOIN_IDENTITY_BUDGET_MS: 5000,
    resolveJoinIdentity: (...args: unknown[]) => resolveJoinIdentity(...args),
  }));
  vi.doMock("~/lib/join-pipeline-metrics.server", () => ({
    recordJoinConfirmSample: (...args: unknown[]) => recordJoinConfirmSample(...args),
  }));
  const { action } = await import("~/routes/join");
  return action;
}

function domainResolution() {
  return {
    kind: "domain",
    ambiguous: false,
    elapsedMs: 12,
    primary: { input: "ridge.com", name: "Ridge", domain: "ridge.com" },
    candidates: [],
    metrics: { liveLookupTimedOut: false, liveLookupAttempted: false },
  };
}

function confirmRequest(cookieValue?: number) {
  const formData = new FormData();
  formData.set("intent", "confirm");
  formData.set("input", "ridge.com");
  const headers: Record<string, string> = {};
  if (cookieValue !== undefined) {
    headers.cookie = `f9_join_touch=${cookieValue}`;
  }
  return new Request("https://0509.io/join", { method: "POST", body: formData, headers });
}

async function runConfirm(action: (...args: never[]) => Promise<unknown>, request: Request) {
  let response: Response | null = null;
  try {
    await action({ context: {}, request } as never);
  } catch (thrown) {
    response = thrown as Response;
  }
  return response;
}

const COOKIE_TTL_MS = 60 * 60 * 1000;

describe("join confirm latency guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    recordJoinConfirmSample.mockClear();
    resolveJoinIdentity.mockReset();
  });

  it("records a real first-touch delta as the confirm latency", async () => {
    resolveJoinIdentity.mockResolvedValue(domainResolution());
    const action = await importAction();

    const response = await runConfirm(action, confirmRequest(Date.now() - 5_000));

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toContain("/auth/signup");
    expect(response?.headers.get("location")).toContain("source=join");
    const sample = recordJoinConfirmSample.mock.calls[0]?.[2] as { latencyMs: number | null };
    expect(sample.latencyMs).not.toBeNull();
    expect(sample.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(sample.latencyMs!).toBeLessThanOrEqual(COOKIE_TTL_MS);
  });

  it("records a forged or stale first-touch cookie with NO latency sample", async () => {
    resolveJoinIdentity.mockResolvedValue(domainResolution());
    const action = await importAction();

    // `f9_join_touch=1` is epoch — a multi-year "latency" that would own p95.
    const response = await runConfirm(action, confirmRequest(1));

    expect(response?.status).toBe(302);
    const sample = recordJoinConfirmSample.mock.calls[0]?.[2] as { latencyMs: number | null };
    expect(sample.latencyMs).toBeNull();
  });

  it("records a missing first-touch cookie with no latency sample", async () => {
    resolveJoinIdentity.mockResolvedValue(domainResolution());
    const action = await importAction();

    const response = await runConfirm(action, confirmRequest());

    expect(response?.status).toBe(302);
    const sample = recordJoinConfirmSample.mock.calls[0]?.[2] as { latencyMs: number | null };
    expect(sample.latencyMs).toBeNull();
  });
});
