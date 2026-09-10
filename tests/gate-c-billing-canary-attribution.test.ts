import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeBillingCanaryResponse,
  validateBillingCanaryResult,
} from "../scripts/dodo-billing-canary.mjs";

const { defaultBilling } = await import("../scripts/verify-post-deploy-release.mjs");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gate C billing canary failure attribution (issue #2646)", () => {
  it("names the HTTP status and the server's own blocker instead of collapsing them", () => {
    const response = Response.json(
      { ok: false, blocker: "billing_canary_account_not_stable" },
      { status: 503 },
    );

    expect(describeBillingCanaryResponse(response, { ok: false, blocker: "billing_canary_account_not_stable" }))
      .toEqual({ status: 503, serverBlocker: "billing_canary_account_not_stable" });
  });

  it("keeps the verdict exactly as strict — a non-2xx response still fails the gate", () => {
    const response = Response.json({ ok: false, blocker: "billing_canary_failed" }, { status: 503 });

    expect(validateBillingCanaryResult({ ok: false, blocker: "billing_canary_failed" }, response, {
      workerVersionId: "worker-v1",
      gateRunId: "gate-c-worker-v1",
    })).toEqual({ ok: false, blocker: "billing_canary_http_failure" });
  });

  it("never surfaces a non-identifier blocker (no payload or secret leakage)", () => {
    const response = Response.json(
      { ok: false, blocker: "owner@example.com token=secret-token" },
      { status: 503 },
    );

    expect(describeBillingCanaryResponse(response, {
      ok: false,
      blocker: "owner@example.com token=secret-token",
    })).toEqual({ status: 503, serverBlocker: null });
  });

  it("records the server blocker on the billing step when the canary returns a 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, blocker: "billing_canary_account_not_stable" },
          { status: 503 },
        )),
    );

    const detail = await defaultBilling({
      workerVersionId: "worker-v1",
      runId: "gate-c-worker-v1",
      token: "secret-token",
    });

    expect(detail).toMatchObject({
      ok: false,
      status: 503,
      serverBlocker: "billing_canary_account_not_stable",
    });
  });
});
