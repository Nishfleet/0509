import { describe, expect, it, vi } from "vitest";

import { runLaunchReadinessCanaryCycle } from "../scripts/launch-readiness-canary-cycle.mjs";

describe("launch readiness canary cycle", () => {
  it("creates fresh proof and removes only the canary-owned graph", async () => {
    const runCanaryImpl = vi
      .fn()
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: {
          ok: true,
          runId: "run-1",
          digestRunId: "digest-1",
          proofCaptureId: "proof-1",
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: {
          ok: true,
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
        payload: { ok: true, runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" },
      })
      .mockResolvedValueOnce({
        response: { ok: true },
        payload: { ok: true, cleanup: { preservedProofCaptureId: "other-proof" } },
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
