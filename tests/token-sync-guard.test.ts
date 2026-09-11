import { describe, expect, it } from "vitest";
import {
  latestVersionIsStale,
  planNextAction,
} from "../scripts/canary-token-sync-lib.mjs";

describe("latestVersionIsStale", () => {
  it("flags the preview-upload pollution state: latest version differs from the deployed version", () => {
    // Verified production state from #1981 (run 34198106528): deploy uploaded
    // 09de873e, then preview-assert uploaded 9acdca1d without deploying it.
    expect(latestVersionIsStale("9acdca1d", "09de873e")).toBe(true);
  });

  it("is false when the latest version is the deployed version", () => {
    expect(latestVersionIsStale("09de873e", "09de873e")).toBe(false);
  });

  it("is false when either id is unknown — never claim unprovable staleness", () => {
    expect(latestVersionIsStale(null, "09de873e")).toBe(false);
    expect(latestVersionIsStale(undefined, "09de873e")).toBe(false);
    expect(latestVersionIsStale("", "09de873e")).toBe(false);
    expect(latestVersionIsStale("9acdca1d", null)).toBe(false);
    expect(latestVersionIsStale("9acdca1d", "")).toBe(false);
  });
});

describe("planNextAction", () => {
  const base = {
    putAttempts: 1,
    repromotes: 0,
    maxAttempts: 10,
    maxRepromotes: 3,
  };

  it("re-promotes when a preview upload moved the latest version", () => {
    expect(
      planNextAction({
        ...base,
        latestVersionId: "9acdca1d",
        deployedVersionId: "09de873e",
      }),
    ).toBe("repromote");
  });

  it("keeps putting when the state is clean (plain lag, not pollution)", () => {
    expect(
      planNextAction({
        ...base,
        latestVersionId: "09de873e",
        deployedVersionId: "09de873e",
      }),
    ).toBe("put");
  });

  it("falls back to putting when the state probe is unavailable", () => {
    expect(planNextAction(base)).toBe("put");
    expect(
      planNextAction({ ...base, latestVersionId: null, deployedVersionId: null }),
    ).toBe("put");
  });

  it("stops re-promoting once the repromote budget is spent", () => {
    expect(
      planNextAction({
        ...base,
        repromotes: 3,
        latestVersionId: "9acdca1d",
        deployedVersionId: "09de873e",
      }),
    ).toBe("put");
  });

  it("gives up only after the attempt budget is exhausted", () => {
    expect(planNextAction({ ...base, putAttempts: 9 })).toBe("put");
    expect(planNextAction({ ...base, putAttempts: 10 })).toBe("give_up");
    // Exhausted attempts beat everything, including pending staleness.
    expect(
      planNextAction({
        putAttempts: 10,
        repromotes: 0,
        maxAttempts: 10,
        maxRepromotes: 3,
        latestVersionId: "9acdca1d",
        deployedVersionId: "09de873e",
      }),
    ).toBe("give_up");
  });
});
