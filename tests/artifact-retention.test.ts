import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const UPLOAD_ACTION = "actions/upload-artifact";
const MAX_RETENTION_DAYS = 7;

const FIXTURE = `on: pull_request
jobs:
  preview-assert:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report-preview
          retention-days: 7
`;

interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Upload {
  file: string;
  step: WorkflowStep;
}

function uploadsOf(source: string): WorkflowStep[] {
  const jobs = (parse(source) as { jobs?: Record<string, WorkflowJob> }).jobs ?? {};
  return Object.values(jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.split("@")[0] === UPLOAD_ACTION);
}

function retentionDays(step: WorkflowStep): number | undefined {
  const declared = step.with?.["retention-days"];
  const days = typeof declared === "string" ? Number(declared) : declared;
  return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : undefined;
}

function label({ file, step }: Upload): string {
  return `${file}: ${step.name ?? step.uses ?? "?"}`;
}

async function workflowFiles(): Promise<string[]> {
  return (await readdir(WORKFLOWS)).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
}

async function allUploads(): Promise<Upload[]> {
  const perFile = await Promise.all(
    (await workflowFiles()).map(async (file) => {
      const source = await readFile(path.join(WORKFLOWS, file), "utf8");
      return uploadsOf(source).map((step) => ({ file, step }));
    }),
  );
  return perFile.flat();
}

describe("artifact uploads declare a bounded retention (0509#7188)", () => {
  it("reads a retention-days value from an upload step", () => {
    const [upload] = uploadsOf(FIXTURE);
    expect(retentionDays(upload)).toBe(7);
  });

  it("finds the artifact uploads the workflows declare", async () => {
    const labels = (await allUploads()).map(label);
    expect(labels).toContain("ci.yml: Keep the trace when it fails");
  });

  it("gives every upload step an explicit retention", async () => {
    const undeclared = (await allUploads())
      .filter((upload) => retentionDays(upload.step) === undefined)
      .map((upload) => `${label(upload)} declares no retention-days`);
    expect(undeclared).toEqual([]);
  });

  it("keeps every retention inside the week the preview report needs", async () => {
    const long = (await allUploads())
      .filter((upload) => (retentionDays(upload.step) ?? 0) > MAX_RETENTION_DAYS)
      .map((upload) => `${label(upload)} keeps ${String(upload.step.with?.["retention-days"])} days`);
    expect(long).toEqual([]);
  });
});
