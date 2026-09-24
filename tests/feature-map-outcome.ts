import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FeatureMapReport {
  kind: "no-drift" | "opened-pr";
  sha: string;
  routes: string[];
  pullRequest?: number;
}

export interface SyncPull {
  title: string;
  body: string;
  files: { filename: string }[];
}

const MAP_FILE = ".agents/skills/verify/feature-map.md";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readReport(raw: string): FeatureMapReport {
  if (raw.trim() === "") {
    throw new Error("silent run: no outcome");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("silent run: outcome shape");
  }
  if (parsed.kind !== "no-drift" && parsed.kind !== "opened-pr") {
    throw new Error("silent run: outcome shape");
  }
  if (typeof parsed.sha !== "string" || parsed.sha === "") {
    throw new Error("silent run: outcome shape");
  }
  if (!Array.isArray(parsed.routes) || parsed.routes.some((route) => typeof route !== "string")) {
    throw new Error("silent run: outcome shape");
  }
  if (parsed.pullRequest != null && typeof parsed.pullRequest !== "number") {
    throw new Error("silent run: outcome shape");
  }
  return {
    kind: parsed.kind,
    sha: parsed.sha,
    routes: parsed.routes,
    pullRequest: parsed.pullRequest,
  };
}

export function summaryFor(report: FeatureMapReport, sha: string): string {
  if (report.sha !== sha) {
    throw new Error(`outcome sha ${report.sha} is not ${sha}`);
  }
  if (report.routes.length === 0 || report.routes.some((route) => route === "")) {
    throw new Error("outcome has no route list");
  }
  if (report.kind === "no-drift") {
    if (report.pullRequest != null) {
      throw new Error("no drift opened a pull request");
    }
    return [`no drift at ${sha}`, ...report.routes].join("\n");
  }
  if (report.pullRequest == null || !Number.isInteger(report.pullRequest)) {
    throw new Error("opened pull request has no number");
  }
  return `opened PR ${report.pullRequest}`;
}

export function assertSyncPull(view: SyncPull, sha: string): void {
  if (view.title !== `feature-map: sync with ${sha}`) {
    throw new Error(`pull title ${view.title}`);
  }
  if (view.body.trim() === "") {
    throw new Error("pull body is empty");
  }
  const names = view.files.map((file) => file.filename);
  if (names.length !== 1 || names[0] !== MAP_FILE) {
    throw new Error(`pull files ${names.join(" ")}`);
  }
}

export function readSyncPull(raw: string): SyncPull {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || typeof parsed.title !== "string") {
    throw new Error("pull view");
  }
  const body = parsed.body == null ? "" : parsed.body;
  if (typeof body !== "string" || !Array.isArray(parsed.files)) {
    throw new Error("pull view");
  }
  const files: { filename: string }[] = [];
  for (const file of parsed.files) {
    if (!isRecord(file)) {
      throw new Error("pull view");
    }
    const filename = typeof file.path === "string" ? file.path : file.filename;
    if (typeof filename !== "string") {
      throw new Error("pull view");
    }
    files.push({ filename });
  }
  return { title: parsed.title, body, files };
}

function record(report: FeatureMapReport, sha: string): void {
  const text = summaryFor(report, sha);
  if (report.kind === "opened-pr") {
    const repo = process.env.GITHUB_REPOSITORY ?? "";
    const viewJson = execFileSync(
      "gh",
      ["pr", "view", String(report.pullRequest), "--repo", repo, "--json", "title,body,files"],
      { encoding: "utf8" },
    );
    assertSyncPull(readSyncPull(viewJson), sha);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, `${text}\n`);
  }
  process.stdout.write(`${text}\n`);
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  record(readReport(process.env.FEATURE_MAP_OUTCOME ?? ""), process.env.FEATURE_MAP_SHA ?? "");
}
