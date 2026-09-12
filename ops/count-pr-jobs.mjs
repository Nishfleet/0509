#!/usr/bin/env node
// Static count of hosted jobs that fire on a pull_request event, for the
// ci-gates-ledger (#3069) before/after record. Merge_group-only jobs are
// excluded (they never run on the PR itself). Reads either a worktree/checkout
// dir (arg 1) or "HEAD" in cwd.
import { readFileSync, readdirSync } from "node:fs";
import yaml from "yaml";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`count-pr-jobs — static count of PR-event hosted jobs (ci-gates-ledger #3069)

Usage:
  node ops/count-pr-jobs.mjs <checkout-dir>   count jobs in that checkout's .github/workflows
  node ops/count-pr-jobs.mjs .                count jobs in cwd
  node ops/count-pr-jobs.mjs --help           this help (no-arg also prints this)

Static model: a workflow's jobs count only when its trigger includes
pull_request or pull_request_target; merge_group-only jobs (job-level if:
containing merge_group) are excluded. Event-conditioned steps (if: on other
event names) are NOT resolved — treat the total as an upper bound, consistent
before/after.`);
  process.exit(args.length === 0 ? 2 : 0);
}
const dir = args[0] === "." ? process.cwd() : args[0];
const wfDir = `${dir}/.github/workflows`;
let total = 0;
for (const f of readdirSync(wfDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
  const path = `${wfDir}/${f}`;
  try {
    const doc = yaml.parse(readFileSync(path, "utf8"));
    // YAML 1.1 parses a bare `on:` key as boolean `true`.
    const onRoot = doc?.on ?? doc?.[true] ?? {};
    // Only workflows that actually declare a PR trigger count. A workflow
    // without any pull_request/pull_request_target key never fires on a PR
    // (push/schedule/dispatch-only) — counting its jobs would poison the
    // per-PR total.
    const prKey = ["pull_request", "pull_request_target"].find((k) =>
      Object.prototype.hasOwnProperty.call(onRoot, k),
    );
    if (!prKey) continue;
    const ev = onRoot[prKey];
    const paths =
      ev && typeof ev === "object" && Object.prototype.hasOwnProperty.call(ev, "paths")
        ? (ev.paths ?? []).join(",")
        : null;
    const jobs = Object.entries(doc.jobs ?? {}).map(([name, j]) => ({
      name: j.name || name,
      mgOnly: typeof j.if === "string" && j.if.includes("merge_group"),
      paths,
    }));
    const prJobs = jobs.filter((j) => !j.mgOnly);
    if (prJobs.length) console.log(`${f}: ${prJobs.map((j) => `${j.name}${paths ? "{paths:" + paths + "}" : ""}`).join(", ")}`);
    total += prJobs.length;
  } catch (e) {
    console.error(`skip ${f}: ${e.message}`);
  }
}
console.log(`TOTAL PR hosted jobs: ${total}`);
