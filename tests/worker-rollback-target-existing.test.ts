import { describe, expect, it } from "vitest";
const { chooseExistingRollbackTarget } = await import("../scripts/worker-rollback-target.mjs");
const v = (id: string, created: string, message?: string) => ({ id, metadata: { created_on: created }, annotations: message ? { "workers/message": message } : {} });
describe("chooseExistingRollbackTarget (2026-09-12: evicted rollback target)", () => {
  it("keeps the recorded target when Cloudflare still lists it", () => {
    const r = chooseExistingRollbackTarget([v("aaaa", "2026-09-10T00:00:00Z"), v("bbbb", "2026-09-12T00:00:00Z")], "aaaa", "bbbb");
    expect(r).toEqual({ versionId: "aaaa", reason: "recorded_target_present" });
  });
  it("falls back to the newest real deploy when the recorded target was evicted (previews skipped)", () => {
    const r = chooseExistingRollbackTarget([
      v("p1", "2026-09-12T08:17:00Z", "preview-assert Nishfleet/0509@x"),
      v("real2", "2026-09-11T20:00:00Z"),
      v("real1", "2026-09-10T20:00:00Z"),
      v("deployed", "2026-09-12T08:05:00Z"),
    ], "evicted", "deployed");
    expect(r).toEqual({ versionId: "real2", reason: "recorded_target_evicted_newest_real_deploy" });
  });
  it("fails loud when only previews and the failed version exist", () => {
    expect(() => chooseExistingRollbackTarget([v("p1", "2026-09-12T08:17:00Z", "preview-assert x"), v("deployed", "2026-09-12T08:05:00Z")], "evicted", "deployed")).toThrow("worker_rollback_target_missing");
  });
});
