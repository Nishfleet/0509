import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PIPELINE_IMPORTERS: Record<string, string> = {
  "app/lib/data/signal.server.ts": "the signal writer: dedup, judging queues, hiring lifecycle",
  "app/lib/data/signal_delivery.server.ts": "records which signals a send used",
  "app/lib/data/jev_verdict.server.ts": "links a verdict to a signal that must exist",
  "app/lib/data/user_decision.server.ts": "stores a customer's feedback on a change",
  "app/lib/data/onboarding_run.server.ts": "times the first signal of a new workspace",
  "app/lib/data/incident.server.ts": "reads the first alert's baseline text for a breakage incident",
  "app/lib/data/work_ledger.server.ts": "counts what was set aside, which the gate hides by design",
  "app/lib/standing-score.server.ts": "counts the inputs still waiting for a verdict",
  "app/lib/site/sweep.server.ts": "looks up the change it just filed",
  "workers/delivery/dlq-consumer.ts": "finds the workspace of a dead-lettered change",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(REPO_ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
}

describe("PIPELINE_SIGNALS importers", () => {
  const importers = [...sourceFiles("app"), ...sourceFiles("workers")].filter((file) => {
    if (file === "app/lib/customer-ready.ts") return false;
    return /\bPIPELINE_SIGNALS\b/.test(readFileSync(path.join(REPO_ROOT, file), "utf8"));
  });

  it("is used only by the listed pipeline files", () => {
    expect(importers.toSorted()).toEqual(Object.keys(PIPELINE_IMPORTERS).toSorted());
  });
});
