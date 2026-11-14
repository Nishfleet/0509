import { bindings, defineConfig, triggers } from "cf/config";

// Config for the support-inbox Email Worker (0509#4229 child 2). Email
// Routing binds a Worker by rule, so there is no routes block. The name is
// 0509-support-inbox-v2 on purpose: 0509-support-inbox is the old Worker and
// still serves some rules, which 0509#5699 moves here. The daily cron runs
// the 90-day support_report delete — this Worker is the table's only writer,
// so the retention sweep lives here and not in workers/app.ts — and it logs
// the stored support_report count.
export default defineConfig({
  worker: {
    name: "0509-support-inbox-v2",
    compatibilityDate: "2026-09-16",
    entrypoint: "./index.ts",
    workersDev: false,
    observability: { enabled: true },
    triggers: [triggers.scheduled({ schedule: "17 3 * * *" })],
    env: {
      DB: bindings.d1({ name: "0509", id: "746c6e3d-782e-443a-82d6-28ca93a16294" }),
    },
  },
});
