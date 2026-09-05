import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = "ops/digest-headline-ratio-guard/0509-digest-headline-ratio-guard-run.sh";
const SERVICE = "ops/digest-headline-ratio-guard/0509-digest-headline-ratio-guard.service";
const PROVISION = "ops/digest-headline-ratio-guard/provision-digest-headline-ratio-guard.sh";

describe("digest headline-ratio guard provision PATH resolution", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "0509-digest-guard-provision-test-"));
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("ships the run script, service, and provisioner", () => {
    for (const path of [RUN, SERVICE, PROVISION]) {
      expect(existsSync(path), `expected ${path} to exist`).toBe(true);
    }
    expect(readFileSync(RUN, "utf8").startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(readFileSync(PROVISION, "utf8").startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("declares the node bin dir placeholder in the service Environment=PATH", () => {
    const service = readFileSync(SERVICE, "utf8");
    expect(service).toContain("Environment=PATH=__NODE_BIN_DIR__:/usr/local/bin:/usr/bin:/bin");
    expect(service).toContain("User=nish");
  });

  it("provisioner resolves the node bin dir and substitutes the placeholder", () => {
    const provision = readFileSync(PROVISION, "utf8");
    expect(provision).toContain("resolve_node_bin_dir");
    expect(provision).toContain("__NODE_BIN_DIR__");
    // The substitution must be a sed replace of the placeholder, not a
    // hardcoded path baked into the repo service file.
    expect(provision).toMatch(/sed[^\n]*s\|__NODE_BIN_DIR__\|/);
  });

  it("substituting the placeholder yields a runnable Environment=PATH", () => {
    const service = readFileSync(SERVICE, "utf8");
    const rendered = service.replaceAll("__NODE_BIN_DIR__", "/home/nish/.local/bin");
    expect(rendered).toContain(
      "Environment=PATH=/home/nish/.local/bin:/usr/local/bin:/usr/bin:/bin",
    );
    expect(rendered).not.toContain("__NODE_BIN_DIR__");
  });

  it("run script fails loud with the resolved PATH when npm is missing", () => {
    // node/npm live under the nish toolchain (~/.local/bin), not /usr/bin, so
    // a systemd-default PATH (no node bin dir) must fail loud. Keep /usr/bin
    // so bash itself resolves.
    const result = spawnSync("bash", [RUN], {
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
        DIGEST_HEADLINE_GUARD_TOKEN_FILE: join(tmpRoot, "no-token.env"),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("node/npm not resolvable on PATH");
    expect(result.stderr).toContain("resolved PATH");
  });
});
