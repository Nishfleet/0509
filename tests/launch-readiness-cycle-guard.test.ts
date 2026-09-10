import { describe, expect, it, vi } from "vitest";

import { runCanary } from "../scripts/launch-readiness-canary.mjs";
import {
  resolveExpectedWorkerVersionId,
  resolveGateRunId,
  runCanaryCycleCli,
  runLaunchReadinessCanaryCycle,
  waitForExpectedWorkerVersion,
} from "../scripts/launch-readiness-canary-cycle.mjs";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => payload,
  } as unknown as Response;
}

describe("launch readiness canary cycle", () => {
  it("creates fresh proof and removes only the canary-owned graph", async () => {
    const runCanaryImpl = vi
      .fn()
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: {
          ok: true,
          workerVersionId: "version-abc",
          runId: "run-1",
          digestRunId: "digest-1",
          proofCaptureId: "proof-1",
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: {
          ok: true,
          workerVersionId: "version-abc",
          cleanup: {
            preservedProofCaptureId: "proof-1",
            deleted: { watchlistRuns: 1, digestRuns: 1 },
          },
        },
      });

    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl,
        expectedWorkerVersionId: "version-abc",
        gateRunId: "1234567890",
      }),
    ).resolves.toMatchObject({
      ok: true,
      proofCaptureId: "proof-1",
    });
    expect(runCanaryImpl).toHaveBeenNthCalledWith(1, {
      config: expect.objectContaining({
        cleanup: false,
        expectedWorkerVersionId: "version-abc",
        gateRunId: "1234567890",
      }),
    });
    expect(runCanaryImpl).toHaveBeenNthCalledWith(2, {
      config: expect.objectContaining({
        cleanup: true,
        expectedWorkerVersionId: "version-abc",
        // Cleanup must send the three cleanup IDs WITHOUT a gate run id —
        // the canary client rejects both together.
        gateRunId: null,
        runId: "run-1",
        digestRunId: "digest-1",
        proofCaptureId: "proof-1",
      }),
    });
  });

  it("fails closed when cleanup does not preserve the proof capture", async () => {
    const runCanaryImpl = vi
      .fn()
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: { ok: true, workerVersionId: "version-abc", runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" },
      })
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: { ok: true, workerVersionId: "version-abc", cleanup: { preservedProofCaptureId: "other-proof" } },
      });

    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl,
        expectedWorkerVersionId: "version-abc",
        gateRunId: "1234567890",
      }),
    ).rejects.toThrow("launch_readiness_proof_capture_not_preserved");
  });

  it("refuses to run unbound — no expected Worker version, no canary", async () => {
    const runCanaryImpl = vi.fn();
    await expect(
      runLaunchReadinessCanaryCycle({ runCanaryImpl, gateRunId: "1234567890" }),
    ).rejects.toThrow("launch_readiness_proof_canary_unbound");
    expect(runCanaryImpl).not.toHaveBeenCalled();
  });

  it("integration: real runCanary sends bound gateRunId body and Worker-version headers", async () => {
    const version = "e8106a7a-be75-401c-a954-0ba0ba94ed41";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          workerVersionId: version,
          runId: "run-1",
          digestRunId: "digest-1",
          proofCaptureId: "proof-1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          workerVersionId: version,
          cleanup: { preservedProofCaptureId: "proof-1" },
        }),
      );

    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl: ({ config }: { config: any }) =>
          runCanary({ config, token: "test-token", fetchImpl }),
        expectedWorkerVersionId: version,
        gateRunId: `deploy-${version}`,
      }),
    ).resolves.toMatchObject({ ok: true, proofCaptureId: "proof-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, startInit] = fetchImpl.mock.calls[0];
    expect(JSON.parse(startInit.body)).toEqual({
      gateRunId: `deploy-${version}`,
    });
    expect(startInit.headers.get("x-0509-expected-worker-version")).toBe(version);
    expect(startInit.headers.get("x-0509-canary-operation")).toBeNull();
    const [, cleanupInit] = fetchImpl.mock.calls[1];
    expect(cleanupInit.headers.get("x-0509-expected-worker-version")).toBe(version);
    expect(cleanupInit.headers.get("x-0509-canary-operation")).toBe("cleanup");
    // Cleanup body carries the three cleanup IDs, never a gateRunId (XOR contract).
    expect(JSON.parse(cleanupInit.body)).toEqual({
      runId: "run-1",
      digestRunId: "digest-1",
      proofCaptureId: "proof-1",
    });
  });

  it("refuses an old Worker that ignores the version-binding header", async () => {
    const runCanaryImpl = vi.fn().mockResolvedValue({
      response: { ok: true },
      payload: {
        ok: true,
        workerVersionId: "old-version",
        runId: "run-1",
        digestRunId: "digest-1",
        proofCaptureId: "proof-1",
      },
    });

    await expect(runLaunchReadinessCanaryCycle({
      runCanaryImpl,
      expectedWorkerVersionId: "version-abc",
      gateRunId: "deploy-version-abc",
    })).rejects.toThrow("launch_readiness_proof_canary_worker_version_mismatch");
    expect(runCanaryImpl).toHaveBeenCalledTimes(1);
  });

  it("reports the cleanup status and safe blocker without retrying mutation", async () => {
    const runCanaryImpl = vi
      .fn()
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        payload: {
          ok: true,
          workerVersionId: "version-abc",
          runId: "run-1",
          digestRunId: "digest-1",
          proofCaptureId: "proof-1",
        },
      })
      .mockResolvedValueOnce({
        response: { ok: false, status: 409 },
        payload: { ok: false, blocker: "shared_rows_present" },
      });

    await expect(runLaunchReadinessCanaryCycle({
      runCanaryImpl,
      expectedWorkerVersionId: "version-abc",
      gateRunId: "deploy-version-abc",
    })).rejects.toThrow(
      "launch_readiness_proof_canary_cleanup_failed:status=409:blocker=shared_rows_present",
    );
    expect(runCanaryImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses cleanup from a different Worker generation", async () => {
    const runCanaryImpl = vi
      .fn()
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: {
          ok: true,
          workerVersionId: "version-abc",
          runId: "run-1",
          digestRunId: "digest-1",
          proofCaptureId: "proof-1",
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: {
          ok: true,
          workerVersionId: "old-version",
          cleanup: { preservedProofCaptureId: "proof-1" },
        },
      });

    await expect(runLaunchReadinessCanaryCycle({
      runCanaryImpl,
      expectedWorkerVersionId: "version-abc",
      gateRunId: "deploy-version-abc",
    })).rejects.toThrow("launch_readiness_cleanup_worker_version_mismatch");
    expect(runCanaryImpl).toHaveBeenCalledTimes(2);
  });

  it("requires three consecutive exact health identities before mutation", async () => {
    const checkHealthImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const delayImpl = vi.fn().mockResolvedValue(undefined);

    await expect(waitForExpectedWorkerVersion({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: "version-abc",
      checkHealthImpl: checkHealthImpl as never,
      delayImpl,
      maxSamples: 4,
      requiredConsecutive: 3,
    })).resolves.toBeUndefined();
    expect(checkHealthImpl).toHaveBeenCalledTimes(4);
    expect(delayImpl).toHaveBeenCalledTimes(3);
  });

  it("requires every production alias to converge in the same consecutive samples", async () => {
    const healthBaseUrls = [
      "https://0509.io",
      "https://www.0509.io",
      "https://api.0509.io",
    ];
    let sample = 0;
    const checkHealthImpl = vi.fn(async ({ baseUrl, expectedSearchRolloutMode }) => {
      const currentSample = Math.floor(sample / healthBaseUrls.length);
      sample += 1;
      return {
        ok: !(currentSample === 0 && baseUrl === "https://www.0509.io"),
        expectedSearchRolloutMode,
      };
    });
    const delayImpl = vi.fn().mockResolvedValue(undefined);

    await expect(waitForExpectedWorkerVersion({
      healthBaseUrls,
      expectedWorkerVersionId: "version-abc",
      checkHealthImpl: checkHealthImpl as never,
      delayImpl,
      maxSamples: 3,
      requiredConsecutive: 2,
    })).resolves.toBeUndefined();
    expect(checkHealthImpl).toHaveBeenCalledTimes(9);
    expect(checkHealthImpl.mock.calls.map(([input]) => input.baseUrl)).toEqual([
      ...healthBaseUrls,
      ...healthBaseUrls,
      ...healthBaseUrls,
    ]);
    expect(checkHealthImpl.mock.calls.every(([input]) =>
      input.expectedSearchRolloutMode === "v2"
    )).toBe(true);
    expect(delayImpl).toHaveBeenCalledTimes(2);
  });

  it("fails before mutation when route propagation never stabilizes", async () => {
    const checkHealthImpl = vi.fn().mockResolvedValue({ ok: false });
    const delayImpl = vi.fn().mockResolvedValue(undefined);

    await expect(waitForExpectedWorkerVersion({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: "version-abc",
      checkHealthImpl: checkHealthImpl as never,
      delayImpl,
      maxSamples: 3,
      requiredConsecutive: 2,
    })).rejects.toThrow("launch_readiness_worker_propagation_not_stable");
    expect(checkHealthImpl).toHaveBeenCalledTimes(3);
    expect(delayImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the default propagation wait bounded at roughly two minutes", async () => {
    const checkHealthImpl = vi.fn().mockResolvedValue({ ok: false });
    const delayImpl = vi.fn().mockResolvedValue(undefined);

    await expect(waitForExpectedWorkerVersion({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: "version-abc",
      checkHealthImpl: checkHealthImpl as never,
      delayImpl,
    })).rejects.toThrow("launch_readiness_worker_propagation_not_stable");
    expect(checkHealthImpl).toHaveBeenCalledTimes(60);
    expect(delayImpl).toHaveBeenCalledTimes(59);
    expect(delayImpl).toHaveBeenCalledWith(2_000);
  });

  it("enforces the wall-clock deadline when a health request stalls", async () => {
    const checkHealthImpl = vi.fn(() => new Promise(() => {}));
    const delayImpl = vi.fn().mockResolvedValue(undefined);

    await expect(waitForExpectedWorkerVersion({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: "version-abc",
      checkHealthImpl: checkHealthImpl as never,
      delayImpl,
      maxWaitMs: 5,
    })).rejects.toThrow("launch_readiness_worker_propagation_not_stable");
    expect(checkHealthImpl).toHaveBeenCalledTimes(1);
    expect(delayImpl).not.toHaveBeenCalled();
  });

  it("integration: missing or malformed binding makes zero HTTP calls", async () => {
    const fetchImpl = vi.fn();
    const runCanaryImpl = ({ config }: { config: any }) =>
      runCanary({ config, token: "test-token", fetchImpl });

    await expect(runLaunchReadinessCanaryCycle({ runCanaryImpl })).rejects.toThrow(
      "launch_readiness_proof_canary_unbound",
    );
    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl,
        expectedWorkerVersionId: "version-abc",
      }),
    ).rejects.toThrow("launch_readiness_proof_canary_gate_run_missing");
    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl,
        expectedWorkerVersionId: "version-abc",
        gateRunId: "NOT VALID!",
      }),
    ).rejects.toThrow("launch_readiness_proof_canary_gate_run_missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails loudly when --wrangler-output is supplied without a value", () => {
    expect(() =>
      resolveExpectedWorkerVersionId(["--wrangler-output"], {
        CANARY_EXPECTED_WORKER_VERSION_ID: "stale-version",
      }),
    ).toThrow("launch_readiness_proof_canary_missing_value:--wrangler-output");
    expect(() =>
      resolveExpectedWorkerVersionId(
        ["--wrangler-output", "--json"],
        {},
      ),
    ).toThrow("launch_readiness_proof_canary_missing_value:--wrangler-output");
  });

  it("derives the gate run id from the deployed Worker version with explicit overrides", () => {
    expect(resolveGateRunId([], {}, "ABC-123")).toBe(
      "deploy-abc-123",
    );
    expect(
      resolveGateRunId(["--gate-run-id", "manual-1"], {}, "abc"),
    ).toBe("manual-1");
    expect(
      resolveGateRunId([], { CANARY_GATE_RUN_ID: "env-1" }, "abc"),
    ).toBe("env-1");
    expect(resolveGateRunId([], {}, null)).toBeNull();
  });

  it("--wait-only runs the waiter then exits without any canary mutation", async () => {
    const waitForExpectedWorkerVersionImpl = vi.fn().mockResolvedValue(undefined);
    const runCycleImpl = vi.fn();

    await expect(
      runCanaryCycleCli({
        argv: ["--wait-only"],
        env: { CANARY_EXPECTED_WORKER_VERSION_ID: "version-abc" },
        waitForExpectedWorkerVersionImpl,
        runCycleImpl,
      }),
    ).resolves.toEqual({
      mode: "wait-only",
      expectedWorkerVersionId: "version-abc",
    });
    expect(waitForExpectedWorkerVersionImpl).toHaveBeenCalledTimes(1);
    expect(waitForExpectedWorkerVersionImpl).toHaveBeenCalledWith({
      expectedWorkerVersionId: "version-abc",
    });
    // The whole point of the fix: zero canary invocations in --wait-only mode.
    expect(runCycleImpl).not.toHaveBeenCalled();
  });

  it("--wait-only still fail-closes on an unbound Worker version — no wait, no canary", async () => {
    const waitForExpectedWorkerVersionImpl = vi.fn().mockResolvedValue(undefined);
    const runCycleImpl = vi.fn();

    await expect(
      runCanaryCycleCli({
        argv: ["--wait-only"],
        env: {},
        waitForExpectedWorkerVersionImpl,
        runCycleImpl,
      }),
    ).rejects.toThrow("launch_readiness_proof_canary_unbound");
    expect(waitForExpectedWorkerVersionImpl).not.toHaveBeenCalled();
    expect(runCycleImpl).not.toHaveBeenCalled();
  });

  it("without --wait-only runs the waiter then the full proof cycle unchanged", async () => {
    const waitForExpectedWorkerVersionImpl = vi.fn().mockResolvedValue(undefined);
    const runCycleImpl = vi.fn().mockResolvedValue({ proofCaptureId: "proof-1" });

    await expect(
      runCanaryCycleCli({
        argv: [],
        env: { CANARY_EXPECTED_WORKER_VERSION_ID: "version-abc" },
        waitForExpectedWorkerVersionImpl,
        runCycleImpl,
      }),
    ).resolves.toEqual({ mode: "cycle", proofCaptureId: "proof-1" });
    expect(waitForExpectedWorkerVersionImpl).toHaveBeenCalledTimes(1);
    expect(runCycleImpl).toHaveBeenCalledTimes(1);
    expect(runCycleImpl).toHaveBeenCalledWith({
      expectedWorkerVersionId: "version-abc",
      gateRunId: "deploy-version-abc",
    });
  });

  it("refuses to run without a gate run id — non-resumable canaries are rejected", async () => {
    const runCanaryImpl = vi.fn();
    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl,
        expectedWorkerVersionId: "version-abc",
      }),
    ).rejects.toThrow("launch_readiness_proof_canary_gate_run_missing");
    await expect(
      runLaunchReadinessCanaryCycle({
        runCanaryImpl,
        expectedWorkerVersionId: "version-abc",
        gateRunId: "NOT VALID!",
      }),
    ).rejects.toThrow("launch_readiness_proof_canary_gate_run_missing");
    expect(runCanaryImpl).not.toHaveBeenCalled();
  });
});
