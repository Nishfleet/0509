import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { APIRequestContext } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../../app/lib/fixture-accounts";
import { classifySettingsDeleteRedirect, deleteAccountViaRequest, isKeptAccount } from "../../e2e/inbox";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const MINT = /e2e\+[\w-]*\$\{/;

const ALLOWED = new Set(["e2e/j14-delete-workspace.spec.ts"]);

const KEPT_JOURNEY_ACCOUNTS = [
  "e2e+j7@0509.io",
  "e2e+j8-hard@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j8-hard-v2@0509.io",
  "e2e+j8-soft-v2@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
  "e2e+soak@0509.io",
  "e2e+onboarded-desktop@0509.io",
  "e2e+onboarded-phone@0509.io",
  "e2e+j6-desktop@0509.io",
  "e2e+j6-phone@0509.io",
  "e2e+j11@0509.io",
];

const SETUP_TEARDOWN_ELSEWHERE = new Set(["e2e/lhci-session.setup.ts"]);

async function e2eFiles(dir: string, suffix: RegExp): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await e2eFiles(full, suffix)));
      continue;
    }
    if (!suffix.test(entry.name)) continue;
    found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
  }
  return found;
}

describe("e2e fixture teardown detector", () => {
  it("bites on a per-run mint, with or without a prefix", () => {
    expect(MINT.test("const email = `e2e+${tag}@0509.io`;")).toBe(true);
    expect(MINT.test("const email = `e2e+onboarded-${lane}-${hex}@0509.io`;")).toBe(true);
    expect(MINT.test("return `e2e+lhci-${hex}@0509.io`;")).toBe(true);
  });

  it("ignores the fixed journey addresses and a non-e2e seed", () => {
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(MINT.test(email)).toBe(false);

    expect(MINT.test("const email = `j6-keyboard-${suffix}@0509.io`;")).toBe(false);
  });

  it("leaves no minting spec without a teardown call", async () => {
    const offenders: string[] = [];
    for (const rel of await e2eFiles(path.join(REPO_ROOT, "e2e"), /\.spec\.ts$/)) {
      if (ALLOWED.has(rel)) continue;
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      if (MINT.test(source) && !source.includes("deleteCreatedAccount")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the journey accounts in the helper's guard", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(source).toContain(email);
  });

  it("keeps every FIXTURE_ACCOUNTS address in the guard, so the teardown never deletes a comp-plan identity", () => {
    for (const account of Object.values(FIXTURE_ACCOUNTS)) expect(KEPT_JOURNEY_ACCOUNTS).toContain(account.email);
  });

  it("pairs every minting setup project with a teardown project", async () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "https://0509.io");
    vi.stubEnv("CF_ACCESS_CLIENT_ID", "probe");
    const { default: config } = await import("../../playwright.config");
    vi.unstubAllEnvs();
    const projects = config.projects ?? [];
    const offenders: string[] = [];
    for (const rel of await e2eFiles(path.join(REPO_ROOT, "e2e"), /\.setup\.ts$/)) {
      if (SETUP_TEARDOWN_ELSEWHERE.has(rel)) continue;
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      if (!MINT.test(source)) continue;
      const owner = projects.find((project) => project.testMatch instanceof RegExp && project.testMatch.test(rel));
      if (owner?.teardown === undefined) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("never turns the J5 bot wall off, so a healthy homepage cannot land in the 24 h identity cache", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/j5-onboard-blocked.spec.ts"), "utf8");
    expect(source).toContain("/__wall?state=on");
    expect(source).not.toContain("/__wall?state=off");
  });

  it("J4 answers the public-subject question the same way J5 and J8 do", async () => {
    for (const rel of [
      "e2e/j4-onboard-creator.spec.ts",
      "e2e/j5-onboard-blocked.spec.ts",
      "e2e/j8-own-site-break.spec.ts",
    ]) {
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      expect(source, rel).toContain("confirmPublicSubject(");
    }
    const helper = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    expect(helper).toContain('getByRole("button", { name: "Yes, a business or creator" })');
    expect(helper).toContain("toPass({ timeout: 30_000 })");
  });

  it("treats every FIXTURE_ACCOUNTS address and the legacy kept accounts as kept, and a per-run one as not", () => {
    for (const account of Object.values(FIXTURE_ACCOUNTS)) {
      expect(isKeptAccount(account.email)).toBe(true);
      expect(isKeptAccount(account.email.toUpperCase())).toBe(true);
    }
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(isKeptAccount(email)).toBe(true);
    expect(isKeptAccount("e2e+abc123@0509.io")).toBe(false);
  });

  it("refuses to delete a FIXTURE_ACCOUNTS session through the request path, and deletes a per-run one", async () => {
    const posted: string[] = [];
    const requestFor = (email: string) =>
      ({
        get: () => Promise.resolve({ status: () => 200, json: () => Promise.resolve({ user: { email } }) }),
        post: (url: string) => {
          posted.push(url);
          return Promise.resolve({ status: () => 302, headers: () => ({ location: "/login?deleted=1" }) });
        },
      }) as unknown as APIRequestContext;

    for (const account of Object.values(FIXTURE_ACCOUNTS)) {
      await deleteAccountViaRequest(requestFor(account.email), "https://0509.io");
    }
    expect(posted).toEqual([]);

    await deleteAccountViaRequest(requestFor("e2e+abc123@0509.io"), "https://0509.io");
    expect(posted).toEqual(["/app/settings"]);
  });

  it("classifies a settings delete redirect as deleted, already gone, or unexpected", () => {
    expect(classifySettingsDeleteRedirect(302, "/login?deleted=abc")).toBe("deleted");
    expect(classifySettingsDeleteRedirect(302, "/login")).toBe("already-gone");
    expect(classifySettingsDeleteRedirect(302, "/login?next=%2Fapp%2Fsettings")).toBe("already-gone");
    expect(classifySettingsDeleteRedirect(200, "/login")).toBe("unexpected");
    expect(classifySettingsDeleteRedirect(302, "/app")).toBe("unexpected");
  });
});
