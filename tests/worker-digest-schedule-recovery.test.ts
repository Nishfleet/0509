import { describe, expect, it, vi } from "vitest";

import { scheduleDigestScheduleExhaustionRecovery } from "../workers/digest-schedule-recovery";

describe("scheduled digest exhaustion recovery", () => {
  it("registers the bounded recovery promise and logs newly reported jobs", async () => {
    const pending: Promise<unknown>[] = [];
    const recover = vi.fn().mockResolvedValue(1);
    const reportFailure = vi.fn();
    const log = vi.fn();

    scheduleDigestScheduleExhaustionRecovery(
      {} as never,
      { waitUntil: (promise) => pending.push(promise) },
      { recover, reportFailure, log },
    );

    expect(pending).toHaveLength(1);
    await pending[0];
    expect(recover).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "digest schedule exhaustion alerts recovered",
      { alerted: 1 },
    );
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports recovery failures under the dedicated scheduled-task key", async () => {
    const pending: Promise<unknown>[] = [];
    const error = new Error("recovery failed");
    const recover = vi.fn().mockRejectedValue(error);
    const reportFailure = vi.fn().mockResolvedValue({ sent: false, reason: "no_db" });

    scheduleDigestScheduleExhaustionRecovery(
      {} as never,
      { waitUntil: (promise) => pending.push(promise) },
      { recover, reportFailure, log: vi.fn() },
    );

    await pending[0];
    expect(reportFailure).toHaveBeenCalledWith(
      expect.anything(),
      "digest_schedule_exhaustion_recovery",
      error,
    );
  });

  it("observes the exact original recovery promise without changing the existing work chain", async () => {
    const pending: Promise<unknown>[] = [];
    const recoveryPromise = Promise.resolve({ attempted: 1, alerted: 0, failed: 1 });
    const recover = vi.fn().mockReturnValue(recoveryPromise);
    const observe = vi.fn((_env, _ctx, _input, promise) => promise);
    const observationContext = { cron: "17 */6 * * *", scheduledTime: 1_768_543_020_000 };

    scheduleDigestScheduleExhaustionRecovery(
      {} as never,
      { waitUntil: (promise) => pending.push(promise) },
      { recover, observe: observe as never, observationContext },
    );

    expect(observe).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { ...observationContext, taskName: "digest_schedule_exhaustion_recovery" },
      recoveryPromise,
    );
    expect(pending).toHaveLength(1);
    await pending[0];
  });
});
