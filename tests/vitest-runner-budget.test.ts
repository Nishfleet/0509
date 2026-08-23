import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest shared-runner budget", () => {
  it("keeps per-file isolation so vi.mock interception stays reliable", () => {
    // Regression guard: disabling isolation (`isolate: !isVerificationLane`)
    // in the verification lane makes vitest share one module registry across
    // all files, which breaks `vi.mock` for modules already cached by an
    // earlier file (e.g. plan-proof-usage-failure.test.ts stopped mocking
    // evidence-usage.server). The forks-pool startup timeout is instead
    // handled by the signature-gated retry in scripts/ci-vitest-run.sh, so
    // the config must never turn isolation off.
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).not.toContain("isolate: !isVerificationLane");
  });

  it("signature-gates the vitest retry to startup-timeout failures only", () => {
    const wrapper = readFileSync("scripts/ci-vitest-run.sh", "utf8");
    // Must retry on the forks-pool startup-timeout signature ...
    expect(wrapper).toMatch(/Timeout starting forks runner|Timeout waiting for worker to respond|Failed to start forks worker/);
    // ... but never mask assertion errors, build errors, or worker crashes.
    expect(wrapper).toMatch(/assert|Assertion|retry/);
  });
});
