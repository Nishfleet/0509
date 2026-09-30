// Deliberately separate from vitest.config.ts: 0509#6161 keeps the Jev evals
// out of `npm test` and out of CI, because they need a live Jev endpoint and a
// LITELLM_JEV_KEY that never enters the repo. Run them with `npm run eval`.
// The eval project also re-reads cases/ on every run and its numbers are a
// measurement, not a gate, so a failed Jev call must not turn a PR red.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "evals",
    environment: "node",
    include: ["tests/evals/**/*.eval.test.ts"],
    // Each case is asked REPEATS times, eight at a time, against a real Jev
    // call. 20 minutes is the ceiling for a full both-questions run.
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
  },
});
