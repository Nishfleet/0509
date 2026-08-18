import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pruner = readFileSync(
  "ops/github-runners/prune-dead-registrations.sh",
  "utf8",
);

describe("dead runner registration pruner", () => {
  it("targets only the stale hardened-runner prefix", () => {
    expect(pruner).toContain("STALE_NAME_PREFIX");
    expect(pruner).toContain("0509-hardened-");
    expect(pruner).toMatch(/"\$\{name\}" == "\$\{STALE_NAME_PREFIX\}"\*/);
  });

  it("explicitly preserves the real fleet and any non-stale name", () => {
    expect(pruner).toContain('"netcup-rs2000-*" fleet) are never touched');
  });

  it("never deletes runners that are not offline", () => {
    expect(pruner).toContain('[[ "${status}" == "offline" ]]');
    expect(pruner).toContain("skipping");
  });

  it("defaults to a dry run and requires --apply to delete", () => {
    expect(pruner).toContain('[[ "${APPLY}" == "" || "${APPLY}" == "--apply" ]]');
    expect(pruner).toContain("dry run");
    expect(pruner).toContain("--apply");
  });

  it("requires explicit GitHub auth", () => {
    expect(pruner).toContain("GITHUB_TOKEN");
    expect(pruner).toContain("GH_TOKEN");
    expect(pruner).toContain("authenticate the gh CLI");
  });

  it("reports a clean fleet without erroring", () => {
    expect(pruner).toContain("fleet is clean");
  });
});
