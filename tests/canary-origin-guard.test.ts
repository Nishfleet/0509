import { describe, expect, it, vi } from "vitest";

import {
  fetchCanary as fetchBillingCanary,
  runCanary as runBillingCanary,
  validateBillingCanaryResult,
  validateCanonicalBaseUrl,
} from "../scripts/dodo-billing-canary.mjs";
import {
  parseArgs as parseLaunchArgs,
  runCanary as runLaunchCanary,
} from "../scripts/launch-readiness-canary.mjs";

const successResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("canary canonical origin guards", () => {
  it("fails closed when the billing endpoint omits proof or cleanup evidence", () => {
    expect(
      validateBillingCanaryResult(
        { ok: true },
        successResponse(),
      ),
    ).toEqual({ ok: false, blocker: "billing_canary_proof_incomplete" });
  });

  it("accepts only a complete successful billing proof", () => {
    expect(
      validateBillingCanaryResult(
        {
          ok: true,
          webhook: { plan: { status: 200 }, proofCredits: { status: 200 } },
          grants: {
            paidPlanUnlocked: true,
            planCleanupOk: true,
            watchlistCleanupOk: true,
            proofCreditsGranted: true,
            proofCreditCleanupOk: true,
            credits: 500,
          },
        },
        successResponse(),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a billing proof with the wrong usage-credit quantity", () => {
    expect(
      validateBillingCanaryResult(
        {
          ok: true,
          webhook: { plan: { status: 200 }, proofCredits: { status: 200 } },
          grants: {
            paidPlanUnlocked: true,
            planCleanupOk: true,
            watchlistCleanupOk: true,
            proofCreditsGranted: true,
            proofCreditCleanupOk: true,
            credits: 1,
          },
        },
        successResponse(),
      ),
    ).toEqual({ ok: false, blocker: "billing_canary_proof_incomplete" });
  });

  it.each([
    "http://0509.io",
    "https://0509.io:443",
    "https://www.0509.io",
    "https://0509.io.evil.example",
    "https://user:pass@0509.io",
    "https://0509.io/api",
  ])("rejects non-canonical billing base URL %s before fetch", async (baseUrl) => {
    expect(() => validateCanonicalBaseUrl(baseUrl)).toThrow();
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runBillingCanary({
        config: {
          baseUrl,
          json: false,
          email: null,
          expectedWorkerVersionId: "worker-v1",
          gateRunId: "gate-run-1",
        },
        token: "secret-token",
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not follow a billing redirect to another origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      }),
    );

    await expect(
      fetchBillingCanary({
        url: new URL("https://0509.io/api/billing/dodo/canary"),
        token: "secret-token",
        fetchImpl,
      }),
    ).rejects.toThrow(/exact https:\/\/0509\.io origin/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toBeDefined();
  });

  it.each([
    "https://0509.io:443/api/billing/dodo/canary",
    "https://user:pass@0509.io/api/billing/dodo/canary",
  ])("rejects credential-bearing initial canary URL %s before sending the token", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchBillingCanary({
        url,
        token: "secret-token",
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows same-origin billing redirects with the token only on the canonical origin", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "/api/billing/dodo/canary?retry=1" },
        }),
      )
      .mockResolvedValueOnce(successResponse());

    await expect(
      fetchBillingCanary({
        url: new URL("https://0509.io/api/billing/dodo/canary"),
        token: "secret-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://0509.io/api/billing/dodo/canary?retry=1",
    );
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("x-0509-canary-token")).toBe(
      "secret-token",
    );
  });

  it("rejects an explicit port in a same-host redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://0509.io:443/api/billing/dodo/canary" },
      }),
    );

    await expect(
      fetchBillingCanary({
        url: new URL("https://0509.io/api/billing/dodo/canary"),
        token: "secret-token",
        fetchImpl,
      }),
    ).rejects.toThrow(/credentials or an explicit port/);
  });

  it("applies the same guard to launch-readiness cleanup requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runLaunchCanary({
        config: parseLaunchArgs([
          "--base-url",
          "https://preview.0509.io",
          "--cleanup",
          "--run-id",
          "run-1",
          "--digest-run-id",
          "digest-1",
          "--proof-capture-id",
          "proof-1",
          "--expected-worker-version",
          "worker-version-1",
        ]),
        token: "secret-token",
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves launch-readiness cleanup headers and body on the canonical origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successResponse());

    await expect(
      runLaunchCanary({
        config: parseLaunchArgs([
          "--cleanup",
          "--run-id",
          "run-1",
          "--digest-run-id",
          "digest-1",
          "--proof-capture-id",
          "proof-1",
          "--expected-worker-version",
          "worker-version-1",
        ]),
        token: "secret-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ response: { status: 200 } });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe("https://0509.io/api/launch-readiness/canary");
    expect(new Headers(requestInit?.headers).get("x-0509-canary-token")).toBe("secret-token");
    expect(new Headers(requestInit?.headers).get("x-0509-canary-operation")).toBe("cleanup");
    expect(new Headers(requestInit?.headers).get("x-0509-expected-worker-version")).toBe("worker-version-1");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      runId: "run-1",
      digestRunId: "digest-1",
      proofCaptureId: "proof-1",
    });
  });

  it("supports interruption-safe cleanup by stable gate run ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successResponse());

    await expect(
      runLaunchCanary({
        config: parseLaunchArgs(["--cleanup", "--gate-run-id", "gate-c-worker-v1"]),
        token: "secret-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ response: { status: 200 } });

    const [, requestInit] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(String(requestInit?.body))).toEqual({ gateRunId: "gate-c-worker-v1" });
  });
});
