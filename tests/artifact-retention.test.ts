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

const ABSENT_RETENTION = `on: pull_request
jobs:
  preview-assert:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report-no-retention
`;

const UNUSABLE_RETENTION = `on: pull_request
jobs:
  preview-assert:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report-zero-retention
          retention-days: 0
`;

const NON_NUMERIC_RETENTION = `on: pull_request
jobs:
  preview-assert:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report-word-retention
          retention-days: seven
`;

const EMPTY_RETENTION = `on: pull_request
jobs:
  preview-assert:
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report-empty-retention
          retention-days:
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

type Retention = { kind: "days"; days: number } | { kind: "absent" } | { kind: "unusable"; declared: unknown };

function uploadsOf(source: string): WorkflowStep[] {
  const jobs = (parse(source) as { jobs?: Record<string, WorkflowJob> }).jobs ?? {};
  return Object.values(jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.split("@")[0] === UPLOAD_ACTION);
}

function retentionOf(step: WorkflowStep): Retention {
  const declared = step.with?.["retention-days"];
  if (declared === undefined) {
    return { kind: "absent" };
  }
  const days = typeof declared === "string" ? Number(declared) : declared;
  if (typeof days === "number" && Number.isInteger(days) && days > 0) {
    return { kind: "days", days };
  }
  return { kind: "unusable", declared };
}

function retentionDays(step: WorkflowStep): number | undefined {
  const retention = retentionOf(step);
  return retention.kind === "days" ? retention.days : undefined;
}

function retentionProblem(step: WorkflowStep): string | undefined {
  const retention = retentionOf(step);
  if (retention.kind === "absent") {
    return "declares no retention-days";
  }
  if (retention.kind === "unusable") {
    return `declares an unusable retention-days: ${JSON.stringify(retention.declared)}`;
  }
  return undefined;
}

function singleUpload(source: string): WorkflowStep {
  const uploads = uploadsOf(source);
  expect(uploads).toHaveLength(1);
  return uploads[0];
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
    const upload = singleUpload(FIXTURE);
    expect(retentionProblem(upload)).toBeUndefined();
    expect(retentionDays(upload)).toBe(7);
  });

  it("names an upload step that declares no retention-days", () => {
    const upload = singleUpload(ABSENT_RETENTION);
    expect(retentionProblem(upload)).toBe("declares no retention-days");
    expect(retentionDays(upload)).toBeUndefined();
  });

  it("names an upload step whose retention-days value is unusable", () => {
    const upload = singleUpload(UNUSABLE_RETENTION);
    expect(retentionProblem(upload)).toBe("declares an unusable retention-days: 0");
    expect(retentionDays(upload)).toBeUndefined();
  });

  it("names an upload step whose retention-days is not a number", () => {
    const upload = singleUpload(NON_NUMERIC_RETENTION);
    expect(retentionProblem(upload)).toBe('declares an unusable retention-days: "seven"');
    expect(retentionDays(upload)).toBeUndefined();
  });

  it("names an upload step whose retention-days is present but empty", () => {
    const upload = singleUpload(EMPTY_RETENTION);
    expect(retentionProblem(upload)).toBe("declares an unusable retention-days: null");
    expect(retentionDays(upload)).toBeUndefined();
  });

  it("finds the artifact uploads the workflows declare", async () => {
    const labels = (await allUploads()).map(label);
    expect(labels).toContain("ci.yml: Keep the trace when it fails");
  });

  it("gives every upload step a positive integer retention", async () => {
    const uploads = await allUploads();
    expect(uploads.length).toBeGreaterThan(0);
    const undeclared = uploads.flatMap((upload) => {
      const problem = retentionProblem(upload.step);
      return problem === undefined ? [] : [`${label(upload)} ${problem}`];
    });
    expect(undeclared).toEqual([]);
  });

  it("keeps every retention inside the week the preview report needs", async () => {
    const long = (await allUploads())
      .filter((upload) => (retentionDays(upload.step) ?? 0) > MAX_RETENTION_DAYS)
      .map((upload) => `${label(upload)} keeps ${String(upload.step.with?.["retention-days"])} days`);
    expect(long).toEqual([]);
  });
});
