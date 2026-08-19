import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest shared-runner budget", () => {
  it("limits workers and file parallelism inside a verification lane", () => {
    const config = readFileSync("vite.config.ts", "utf8");

    expect(config).toContain("DEPLOY_WINDOW_VERIFY_SLOT");
    expect(config).toContain("maxWorkers: isVerificationLane ? 1 : undefined");
    expect(config).toContain("fileParallelism: !isVerificationLane");
    // Disabling isolation inside the lane reuses one long-lived fork worker
    // for the whole suite, so only one worker startup happens per run instead
    // of one per file. Vitest's forks-pool startup budget is hardcoded
    // upstream, so this is what removes the intermittent
    // "[vitest-pool]: Timeout starting forks runner." failure.
    expect(config).toContain("isolate: !isVerificationLane");
  });
});
