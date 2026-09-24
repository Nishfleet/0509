import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #4252: the feature-map workflow is the automation that keeps the map
// current. These asserts read the workflow file, the same way
// tests/opus-review-job.test.ts reads ci.yml.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("feature-map workflow", () => {
  it("triggers on main path changes and workflow_dispatch, and does not cancel a running sync", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/feature-map.yml"), "utf8");
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain("group: feature-map");
    expect(yaml).toContain("cancel-in-progress: false");
    for (const watched of ["app/routes.ts", "app/routes/**", "e2e/**", ".agents/skills/verify/**"]) {
      expect(yaml).toContain(watched);
    }
    expect(yaml).toMatch(/push:[\s\S]*branches:[\s\S]*- main/);
  });

  it("uses the same claude-code-action pin and oauth token as opus-review", async () => {
    const [map, ci] = await Promise.all([
      readFile(path.join(REPO_ROOT, ".github/workflows/feature-map.yml"), "utf8"),
      readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
    ]);
    const pin = ci.match(/uses: anthropics\/claude-code-action@([0-9a-f]+)/);
    expect(pin).not.toBeNull();
    expect(map).toContain(`anthropics/claude-code-action@${pin?.[1]}`);
    expect(map).toContain("claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(map).toContain('allowed_bots: "nishfleet-worker,github-actions"');
  });

  it("re-dispatches a push because the action rejects that event", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/feature-map.yml"), "utf8");
    expect(yaml).toContain('if: github.event_name == \'push\'');
    expect(yaml).toContain('if: github.event_name == \'workflow_dispatch\'');
    expect(yaml).toContain("gh workflow run feature-map.yml --ref \"$GITHUB_REF_NAME\" --repo \"$GITHUB_REPOSITORY\"");
    expect(yaml).toContain("Unsupported event type: push");
    expect(yaml).not.toContain("pull_request:");
  });

  it("keeps the sync prompt and fails a silent run", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/feature-map.yml"), "utf8");
    expect(yaml).toContain("npm run verify:start");
    expect(yaml).toContain("take_snapshot");
    expect(yaml).toContain("feature-map: sync with");
    expect(yaml).toContain("no drift at");
    expect(yaml).toContain("A silent run counts as a failure");
    expect(yaml).toContain("5xx");
    expect(yaml).toContain("silent run: no outcome file");
    expect(yaml).toContain('tee -a "$GITHUB_STEP_SUMMARY"');
    expect(yaml).toContain('feature-map: sync with ${SHA} in:title');
    expect(yaml).toContain('.agents/skills/verify/feature-map.md');
    expect(yaml).not.toContain("claude-execution-output.json");
  });
});
