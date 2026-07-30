import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest shared-runner budget", () => {
  it("limits workers and file parallelism inside a verification lane", () => {
    const config = readFileSync("vite.config.ts", "utf8");

    expect(config).toContain("DEPLOY_WINDOW_VERIFY_SLOT");
    expect(config).toContain("maxWorkers: isVerificationLane ? 1 : undefined");
    expect(config).toContain("fileParallelism: !isVerificationLane");
  });
});
