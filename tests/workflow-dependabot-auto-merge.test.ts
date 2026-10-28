import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW = ".github/workflows/dependabot-auto-merge.yml";

const FETCH_METADATA = /dependabot\/fetch-metadata@([0-9a-f]{40})/;
const JOB_PERMISSION_KEY = /^ {6}([a-z-]+): /;

function lines(): string[] {
  return readFileSync(path.join(ROOT, WORKFLOW), "utf8").split("\n");
}

function jobPermissions(): string[] {
  return lines().flatMap((line) => JOB_PERMISSION_KEY.exec(line)?.[1] ?? []);
}

describe("the Dependabot auto-merge workflow arms only a patch or a minor update (0509#7747)", () => {
  it("runs on a pull request event and no other", () => {
    expect(lines().filter((line) => /^on:/.test(line))).toEqual(["on: pull_request"]);
  });

  it("runs only for a pull request Dependabot opened", () => {
    const workflow = lines().join("\n");
    expect(workflow).toContain("if: github.event.pull_request.user.login == 'dependabot[bot]'");
    expect(workflow).not.toContain("github.actor");
  });

  it("writes nothing by default and holds only the merge permission it needs", () => {
    expect(lines()).toContain("permissions: {}");
    expect(jobPermissions()).toEqual(["contents", "pull-requests"]);
  });

  it("arms a patch or a minor update and leaves a major to a person", () => {
    const workflow = lines().join("\n");
    expect(workflow).toContain("steps.metadata.outputs.update-type == 'version-update:semver-patch'");
    expect(workflow).toContain("steps.metadata.outputs.update-type == 'version-update:semver-minor'");
    expect(workflow).not.toContain("version-update:semver-major");
  });

  it("pins fetch-metadata to a commit", () => {
    expect(FETCH_METADATA.exec(lines().join("\n"))?.[1] ?? "").toMatch(/^[0-9a-f]{40}$/);
  });

  it("checks out no pull request code and reads no repository secret", () => {
    const workflow = lines().join("\n");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).not.toContain("secrets.");
  });

  it("arms with the run's own token and no wider one", () => {
    const workflow = lines().join("\n");
    expect(workflow).toContain('run: gh pr merge --auto --squash "$PR_URL"');
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
  });
});
