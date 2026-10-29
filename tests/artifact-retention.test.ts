import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const UPLOAD_ACTION = "actions/upload-artifact";
const MAX_RETENTION_DAYS = 7;
const BACKUP_ARTIFACT_PREFIX = "d1-backup-";
const MAX_BACKUP_RETENTION_DAYS = 90;

function retentionFixture(retentionDays?: string): string {
  const retention = retentionDays === undefined ? "" : `          retention-days: ${retentionDays}\n`;
  return `on: pull_request
jobs:
  preview-assert:
    steps:
      - name: playwright-report-preview
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-preview
${retention}`;
}

const FIXTURE = retentionFixture("7");

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

function retentionCeiling(step: WorkflowStep): number {
  const name = step.with?.name;
  return typeof name === "string" && name.startsWith(BACKUP_ARTIFACT_PREFIX) ? MAX_BACKUP_RETENTION_DAYS : MAX_RETENTION_DAYS;
}

function retentionProblem(upload: Upload): string | undefined {
  if (!upload.step.with || !("retention-days" in upload.step.with)) {
    return `${label(upload)} declares no retention-days`;
  }
  if (retentionDays(upload.step) === undefined) {
    return `${label(upload)} has an unusable retention-days ${JSON.stringify(upload.step.with["retention-days"])}`;
  }
  return undefined;
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
    const uploads = uploadsOf(FIXTURE);
    expect(uploads).toHaveLength(1);
    expect(retentionDays(uploads[0])).toBe(7);
  });

  it("pins the absent-key message when the upload step declares no retention-days", () => {
    const [upload] = uploadsOf(retentionFixture());
    expect(retentionProblem({ file: "fixture.yml", step: upload })).toBe(
      "fixture.yml: playwright-report-preview declares no retention-days",
    );
  });

  it.each([
    ["an empty value, which YAML reads as null", "", "null"],
    ["a non-numeric value", "seven", '"seven"'],
  ])("pins the unusable-value message when retention-days has %s", (_case, raw, shown) => {
    const [upload] = uploadsOf(retentionFixture(raw));
    expect(retentionProblem({ file: "fixture.yml", step: upload })).toBe(
      `fixture.yml: playwright-report-preview has an unusable retention-days ${shown}`,
    );
  });

  it("finds the artifact uploads the workflows declare", async () => {
    const labels = (await allUploads()).map(label);
    expect(labels).toContain("ci.yml: Keep the trace when it fails");
  });

  it("gives every upload step an explicit retention", async () => {
    const uploads = await allUploads();
    expect(uploads.length).toBeGreaterThan(0);
    const problems = uploads.map(retentionProblem).filter(Boolean);
    expect(problems).toEqual([]);
  });

  it("keeps every retention inside the week the preview report needs", async () => {
    const long = (await allUploads())
      .filter((upload) => (retentionDays(upload.step) ?? 0) > retentionCeiling(upload.step))
      .map((upload) => `${label(upload)} keeps ${String(upload.step.with?.["retention-days"])} days`);
    expect(long).toEqual([]);
  });

  it("lets a d1-backup artifact keep 90 days and no more", () => {
    const backup = (raw: string) => uploadsOf(retentionFixture(raw).replaceAll("playwright-report-preview", `${BACKUP_ARTIFACT_PREFIX}0509`))[0];
    expect(retentionCeiling(backup("90"))).toBe(MAX_BACKUP_RETENTION_DAYS);
    expect(retentionDays(backup("90"))).toBe(MAX_BACKUP_RETENTION_DAYS);
    expect(retentionDays(backup("91"))).toBeGreaterThan(retentionCeiling(backup("91")));
  });

  it("keeps the week cap on an artifact whose name only contains a backup name", () => {
    const [upload] = uploadsOf(retentionFixture("90").replaceAll("playwright-report-preview", `report-of-${BACKUP_ARTIFACT_PREFIX}0509`));
    expect(retentionCeiling(upload)).toBe(MAX_RETENTION_DAYS);
  });
});
