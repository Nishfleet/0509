import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Deliberately a separate config from vite.config.ts.
//
// vitest picks up vite.config.ts by default, which carries the cloudflare()
// BUILD plugin. That plugin puts the app's Worker entry inside the test runner
// and the runner then evaluates it as CommonJS, giving
// "ReferenceError: module is not defined at workers/runner-worker/index.js:107".
// The build plugin and the test plugin are different things; only
// cloudflareTest() belongs here.
export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic: no bindings, no workerd.
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/**", "tests/unit/site/**", "tests/perf/**"],
        },
      },
      {
        // Real workerd + real local D1 with migrations/0001_rebuild.sql applied.
        // The only project where a D1 assertion means anything.
        // tests/unit/site also runs here: HTMLRewriter exists only in workerd,
        // and the node project has no runtime to host it.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./tests/integration/wrangler.test.jsonc" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations("migrations") },
            },
          })),
        ],
        test: {
          name: "workers",
          include: [
            "tests/integration/**/*.integration.test.ts",
            // #4180's acceptance names this file verbatim, without the
            // .integration infix; it still needs real workerd + real D1.
            "tests/integration/migration-rollback.test.ts",
            "tests/unit/site/**/*.test.ts",
            "tests/perf/**/*.test.ts",
          ],
          // Applies the chain itself, in two steps, so it can seed rows
          // before 0015. The workers setup would apply 0015 first.
          exclude: ["tests/integration/entity-workspace-fk.integration.test.ts"],
          setupFiles: ["./tests/integration/apply-migrations.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // 0509#4707 applies migrations in the test: prior files, seed, then
        // 0015. The workers project setup applies the whole chain first, so
        // this file cannot prove that the rebuild kept rows already stored.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./tests/integration/wrangler.test.jsonc" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations("migrations") },
            },
          })),
        ],
        test: {
          name: "entity-fk",
          include: ["tests/integration/entity-workspace-fk.integration.test.ts"],
          testTimeout: 60_000,
        },
      },
      {
        // The J1 mail-sink Worker (0509#3927, 0509#4210): real workerd and a
        // real local SQLite Durable Object. Its token gate and email handler
        // run against the same binding kinds production has. A broken gate
        // fails in a merge gate, not in CI's production lane.
        plugins: [
          cloudflareTest(() => ({
            wrangler: { configPath: "./tests/integration/wrangler.e2e-inbox.test.jsonc" },
          })),
        ],
        test: {
          name: "e2e-inbox",
          include: ["tests/integration/e2e-inbox.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // The support-inbox Email Worker (0509#4229): real workerd + real
        // local D1 with migrations applied, so the support_report insert and
        // the text-free issue body run against the schema the deploy ships.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./tests/integration/wrangler.support-inbox.test.jsonc" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations("migrations") },
            },
          })),
        ],
        test: {
          name: "support-inbox",
          include: ["tests/integration/support-inbox.test.ts"],
          setupFiles: ["./tests/integration/apply-migrations.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // The J8 fixture-site Worker (0509#4046): real workerd + real local SQLite Durable Object.
        // Its token-gated flip route and both break modes run against the same
        // binding kinds production has, so a break that does not survive the
        // round-trip fails in a merge gate instead of a live incident run.
        plugins: [
          cloudflareTest(() => ({
            wrangler: { configPath: "./tests/integration/wrangler.fixture-site.test.jsonc" },
          })),
        ],
        test: {
          name: "fixture-site",
          include: ["tests/integration/fixture-site.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // The P3 fetch-then-browser transport (0509#3971): real workerd for the
        // plain-fetch leg and the HTMLRewriter text extraction, so the escalation
        // predicates run against the same global `fetch`, `AbortSignal.timeout`
        // and `HTMLRewriter` production uses. The outbound `fetch` is stubbed per
        // test so every trigger is reachable deterministically, and `env` is
        // mocked, so the browser binding declared below validates the config
        // shape only.
        plugins: [
          cloudflareTest(() => ({
            wrangler: { configPath: "./tests/integration/wrangler.transport.test.jsonc" },
          })),
        ],
        test: {
          name: "transport",
          include: ["tests/integration/transport.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
