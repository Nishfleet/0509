import { expect, test } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  readFirstBriefState,
  seedFreshFirstBriefEvidence,
} from "../../scripts/bet7-activation-verification.mjs";
import { resolveE2ePersistPath } from "../../scripts/e2e-local-fixture.mjs";
import { resolveLocalD1DatabasePath } from "../../scripts/e2e-local-state-query.mjs";
import { reserveLocalReleaseOrigin } from "../../scripts/local-release-server.mjs";

/**
 * Issue #1487 — BET 7 termination spec.
 *
 * The issue's termination command is:
 *   npx playwright test --config=playwright.config.ts --project=workspace \
 *     tests/e2e/activation-first-brief.spec.ts
 *
 * This spec is self-contained: it does NOT rely on the shared webServer block
 * (which never sets SIGNUP_FIRST_BRIEF_ENABLED — the surface under test would
 * stay dark). It builds an isolated local D1, seeds the activation first-scan
 * evidence chain with the same helper the shipped `canary:bet7` script uses
 * (scripts/bet7-activation-verification.mjs — provider network is denied in
 * local E2E, so a live landing-page fetch cannot complete unattended), then
 * boots its own dev server on an ephemeral loopback port with the first-brief
 * and funnel-measurement flags on.
 *
 * Assertions, in order:
 *   1. `/app/onboard?step=first-brief` answers 200 (no redirect — the flag
 *      parser regression from issue #1416),
 *   2. the on-screen brief renders at least one evidence-linked item
 *      (accept #1, #2),
 *   3. the `funnel_first_brief_viewed` event is emitted by the loader
 *      (accept #5 — account-scoped funnel event, in the same session),
 *   4. the `first_brief` digest_run row lands in D1 (the artifact of the
 *      in-session file + dispatch path, accept #4), and
 *   5. a `delivery_attempt` row exists for that digest run — the dispatch ran;
 *      the local E2E stack declares no `send_email` binding, so the provider
 *      leg cannot truly send here (same limitation the canary documents). The
 *      mocked contract test (tests/activation/first-brief-same-session.test.tsx)
 *      and the workers-project integration test
 *      (tests/integration/signup-first-brief.integration.test.ts) cover the
 *      provider-bound send.
 */

const SERVER_BOOT_TIMEOUT_MS = 120_000;
const SERVER_READY_POLL_MS = 1_000;
const ON_SCREEN_DEADLINE_MS = 2 * 60_000;
const DIGEST_POLL_TIMEOUT_MS = 30_000;

const FIXTURE_COOKIE = "f9_e2e_fixture";
const TEST_MODE_HEADER = "x-0509-e2e-test-mode";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverLogTail(buffer: string[]) {
  return buffer.join("").slice(-4000);
}

test("fresh signup renders an evidence-linked first brief and dispatches the email in-session", async ({
  browser,
}) => {
  test.setTimeout(SERVER_BOOT_TIMEOUT_MS + ON_SCREEN_DEADLINE_MS + 120_000);

  const token = Date.now().toString(36);
  const email = `bet7-${token}@activation.0509.test`;
  const repoRoot = process.cwd();
  const persist = resolveE2ePersistPath(repoRoot, `.wrangler/e2e-activation-${token}`);
  mkdirSync(persist.absolutePath, { recursive: true });

  const prepare = spawnSync(process.execPath, ["scripts/e2e-prepare-local.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, E2E_PERSIST_PATH: persist.relativePath },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(
    prepare.status,
    `e2e-prepare-local failed:\n${prepare.stderr || prepare.stdout || `exit ${prepare.status}`}`,
  ).toBe(0);

  const ids = seedFreshFirstBriefEvidence({
    token,
    email,
    domain: "nykaa.com",
    persistPath: persist.absolutePath,
  });

  const originInfo = await reserveLocalReleaseOrigin({
    preferredPort: 0,
    fallbackToEphemeral: true,
  });
  const origin = originInfo.origin;

  const serverLog: string[] = [];
  let serverProc: ChildProcess | null = null;

  try {
    // The generated worker-configuration.d.ts narrows NodeJS.ProcessEnv to the
    // production literal values, so this is a plain record, not ProcessEnv.
    const env: Record<string, string | undefined> = {
      ...process.env,
      E2E_PERSIST_PATH: persist.relativePath,
      E2E_TEST_MODE: "1",
      E2E_PROVIDER_NETWORK_DENY: "1",
      E2E_SEARCH_ROLLOUT_MODE: "v2",
      AUTH_PROVIDER: "better-auth",
      BETTER_AUTH_SECRET: "local-test-secret-local-test-secret-local",
      SIGNUP_FIRST_BRIEF_ENABLED: "1",
      FUNNEL_MEASUREMENT_ENABLED: "1",
      BETTER_AUTH_URL: origin,
      APP_ORIGIN: origin,
    };
    await originInfo.release();
    serverProc = spawn(
      "./node_modules/.bin/react-router",
      ["dev", "--host", "127.0.0.1", "--port", String(originInfo.port), "--strictPort"],
      { cwd: repoRoot, env: env as NodeJS.ProcessEnv },
    );
    serverProc.stdout?.on("data", (chunk) => serverLog.push(String(chunk)));
    serverProc.stderr?.on("data", (chunk) => serverLog.push(String(chunk)));

    const readyDeadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < readyDeadline) {
      if (serverProc.exitCode !== null) break;
      try {
        const response = await fetch(`${origin}/api/health`);
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // Server not accepting connections yet.
      }
      await sleep(SERVER_READY_POLL_MS);
    }
    expect(
      ready,
      `dev server did not become ready:\n${serverLogTail(serverLog)}`,
    ).toBe(true);

    const context = await browser.newContext();
    await context.setExtraHTTPHeaders({ [TEST_MODE_HEADER]: "1" });
    await context.addCookies([
      { name: FIXTURE_COOKIE, value: ids.userId, url: origin, httpOnly: true },
    ]);
    const page = await context.newPage();

    // The loader files + delivers the first-brief digest via the real app
    // code path, so a single navigation exercises accept #1, #2 and #4.
    const response = await page.goto(`${origin}/app/onboard?step=first-brief`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const status = response?.status() ?? 0;
    expect(
      status,
      `onboard first-brief step redirected or errored (status=${status}) — flag parser regression`,
    ).toBe(200);

    const evidenceLink = page
      .locator('.f9-signup-first-brief-evidence a[href^="http"]')
      .first();
    try {
      await evidenceLink.waitFor({ state: "visible", timeout: ON_SCREEN_DEADLINE_MS });
    } catch (error) {
      const dbPath = resolveLocalD1DatabasePath(persist.absolutePath);
      const debug = readFirstBriefState({ dbPath, userId: ids.userId });
      throw new Error(
        `on-screen first brief did not reach ready. digestRun=${JSON.stringify(debug.digestRow)}\n${serverLogTail(serverLog)}`,
        { cause: error },
      );
    }
    const href = await evidenceLink.getAttribute("href");
    expect(href, "first brief evidence link must be an absolute URL").toMatch(/^https?:\/\//);

    // The funnel event is emitted inside the same loader render — by the time
    // the brief is visible the structured log line has been written.
    expect(
      serverLog.join(""),
      "funnel_first_brief_viewed must be emitted in the same session",
    ).toContain("funnel_first_brief_viewed");

    // The in-session file + dispatch artifact: the first_brief digest_run row.
    const dbPath = resolveLocalD1DatabasePath(persist.absolutePath);
    const digestDeadline = Date.now() + DIGEST_POLL_TIMEOUT_MS;
    let digestRunId: string | null = null;
    while (Date.now() < digestDeadline) {
      const state = readFirstBriefState({ dbPath, userId: ids.userId });
      if (state.digestRow) {
        digestRunId = String(state.digestRow.id);
        break;
      }
      await sleep(1_000);
    }
    expect(
      digestRunId,
      "first_brief digest_run row did not land in D1",
    ).toBeTruthy();

    // Dispatch proof: a delivery_attempt row joined to the filed digest. The
    // provider cannot send without a `send_email` binding, so any durable
    // status (pending/failed) proves the dispatch path ran in-session.
    const attemptsDb = new DatabaseSync(dbPath, { readOnly: true });
    let attemptRow: Record<string, unknown> | undefined;
    try {
      attemptsDb.exec("PRAGMA busy_timeout = 1000");
      attemptRow = attemptsDb
        .prepare(
          `SELECT id, status, channel FROM delivery_attempt
            WHERE digest_run_id = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(digestRunId) as Record<string, unknown> | undefined;
    } finally {
      attemptsDb.close();
    }
    expect(
      attemptRow,
      "no delivery_attempt row for the first-brief digest — dispatch did not run",
    ).toBeTruthy();
    expect(attemptRow?.channel).toBe("email");

    await context.close();
  } finally {
    if (serverProc && serverProc.exitCode === null) {
      serverProc.kill("SIGTERM");
      await sleep(800);
      serverProc.kill("SIGKILL");
    }
    rmSync(persist.absolutePath, { force: true, recursive: true });
  }
});
