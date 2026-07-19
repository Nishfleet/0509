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

    await expect(runLaunchReadinessCanaryCycle({ runCanaryImpl })).resolves.toMatchObject({
      ok: true,
      proofCaptureId: "proof-1",
    });
    expect(runCanaryImpl).toHaveBeenNthCalledWith(2, {
      config: expect.objectContaining({
        cleanup: true,
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

    await expect(runLaunchReadinessCanaryCycle({ runCanaryImpl })).rejects.toThrow(
      "launch_readiness_proof_capture_not_preserved",
    );
  });
});
