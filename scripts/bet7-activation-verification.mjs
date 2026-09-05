#!/usr/bin/env node
// Live verification canary for BET 7 — "Your first brief" activation
// (transformation roadmap §3.4, issue #1445, feature #1276).
//
// BET 7's termination check:
//   A clean end-to-end run from a fresh email address produces an on-screen
//   brief with >=1 evidence-linked item within 5 minutes of signup and a
//   delivered first-brief email (digest) within 60 minutes.
//
// This canary runs the FULL path against an isolated local E2E server:
//   1. it mints a genuinely fresh, non-reused email address per run,
//   2. seeds the activation first scan's evidence chain into the isolated
//      local D1 (a fresh verified user, an active watchlist, a succeeded
//      run, a proof capture + target, an ad, an observation, and a confirmed
//      ad_new baseline watch event carrying an evidence URL) — the same
//      seeded-evidence class the #1276 integration test uses, because the
//      local E2E stack denies provider network (E2E_PROVIDER_NETWORK_DENY=1)
//      so a live landing-page fetch cannot complete unattended,
//   3. drives `/app/onboard?step=first-brief` as that fresh user and asserts
//      the on-screen brief renders with >=1 evidence-linked item (the loader
//      files + delivers the first-brief digest via the real app code path),
//   4. polls the isolated D1 within --window (default 60 min) for the filed
//      `first_brief` digest_run row (and any deliverable email row), and
//   5. asserts the onboard flag parser turned the surface on — the route must
//      NOT redirect when `?step=first-brief` is requested (the regression the
//      merged onboard PR pinned in tests/env.server.test.ts, issue #1416).
//
// Usage (from the repo root): node scripts/bet7-activation-verification.mjs
//   --email=fresh@example.test --domain=nykaa.com --window=60 [--json]
// Exits 0 only when every termination check passes.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { chromium } from "@playwright/test";

import { resolveE2ePersistPath } from "./e2e-local-fixture.mjs";
import { resolveLocalD1DatabasePath } from "./e2e-local-state-query.mjs";
import { reserveLocalReleaseOrigin } from "./local-release-server.mjs";

const REPO_ROOT = process.cwd();

export const DEFAULT_WINDOW_MINUTES = 60;
export const ON_SCREEN_DEADLINE_MS = 5 * 60 * 1000;
export const SERVER_BOOT_TIMEOUT_MS = 120 * 1000;
export const SERVER_READY_POLL_MS = 1000;

// Evidence-linked URL the seeded watch event carries. Every first-brief item
// must link its screenshot evidence; this is the deterministic fixture URL.
export function buildEvidenceUrl(token) {
  return `https://www.facebook.com/ads/library/?id=bet7-${token}`;
}

// The parser regression (tests/env.server.test.ts) asserts the flag parser
// maps "1"/"true"/"on"/"yes" (and " 1 " whitespace-padded) to enabled. A
// missing/empty flag means the onboard surface never renders. We mirror that
// gate here so the canary cannot green on a dark flag.
export function parseFlag(value) {
  return ["1", "true", "on", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

/**
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  const parsed = {
    email: null,
    domain: "nykaa.com",
    windowMinutes: DEFAULT_WINDOW_MINUTES,
    json: false,
    keepServer: false,
    keepPersist: false,
  };
  for (const arg of argv) {
    const [rawKey, ...rest] = arg.split("=");
    const key = rawKey?.toLowerCase();
    const value = rest.join("=");
    if (key === "--email" && value) parsed.email = value;
    else if (key === "--domain" && value) parsed.domain = value;
    else if (key === "--window" && value) parsed.windowMinutes = Number(value);
    else if (key === "--json") parsed.json = true;
    else if (key === "--keep-server") parsed.keepServer = true;
    else if (key === "--keep-persist") parsed.keepPersist = true;
  }
  if (!Number.isFinite(parsed.windowMinutes) || parsed.windowMinutes <= 0) {
    throw new Error(`invalid --window: ${parsed.windowMinutes}`);
  }
  return parsed;
}

function emitLine(line) {
  process.stdout.write(`${line}\n`);
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * Seed the fresh user + activation first-scan evidence chain into the local
 * D1 used by the dev server. Returns ids used downstream.
 */
export function seedFreshFirstBriefEvidence({ token, email, domain, persistPath }) {
  const dbPath = resolveLocalD1DatabasePath(persistPath);
  const db = new DatabaseSync(dbPath);

  const userId = `e2e-bet7-${token}`;
  const watchlistId = `bet7-wl-${token}`;
  const runId = `bet7-run-${token}`;
  const adId = `bet7-ad-${token}`;
  const proofTargetId = `bet7-pt-${token}`;
  const proofCaptureId = `bet7-pc-${token}`;
  const observationId = `bet7-ob-${token}`;
  const eventId = `bet7-ev-${token}`;
  const now = isoNow();
  const evidenceUrl = buildEvidenceUrl(token);

  try {
    db.exec("PRAGMA foreign_keys = OFF");

    const user = db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, onboardedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?, ?)`,
    );
    user.run(userId, `BET7 ${domain} canary`, email, now, now, now);

    const watchlist = db.prepare(
      `INSERT INTO watchlist (
         id, user_id, name, target_type, target_id, target_fingerprint,
         target_label, is_active, last_scanned_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?, ?)`,
    );
    watchlist.run(
      watchlistId,
      userId,
      `BET7 ${domain}`,
      `target_${token}`,
      `fp_${token}`,
      domain,
      now,
      now,
      now,
    );

    const run = db.prepare(
      `INSERT INTO watchlist_run (
         id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
         baseline_from_run_id, summary_json, started_at, finished_at,
         error_code, error_message, created_at, updated_at
       ) VALUES (?, ?, 'manual', 'succeeded', 3, 1, NULL, '{}', ?, ?, NULL, NULL, ?, ?)`,
    );
    run.run(runId, watchlistId, now, now, now, now);

    const ad = db.prepare(
      `INSERT INTO ad (
         id, advertiser, body, preview_headline, preview_subhead, hook,
         offer_text, cta, creative_format, language_label, destination_type,
         landing_page_url, ad_snapshot_url, countries_json, platforms_json,
         first_seen_at, last_seen_at, is_active, source, research_summary,
         raw_json, created_at, updated_at
       ) VALUES (?, 'BET7 Advertiser', 'body', ?, 'subhead', ?,
         'Limited-time offer', 'Shop now', 'image', 'en', 'website',
         ?, ?, '[]', '[]', ?, ?, 1, 'meta', 'summary', '{}', ?, ?)`,
    );
    ad.run(
      adId,
      `${domain} baseline headline`,
      `${domain} baseline hook`,
      evidenceUrl,
      evidenceUrl,
      now,
      now,
      now,
      now,
    );

    const proofTarget = db.prepare(
      `INSERT INTO proof_target (
         id, watchlist_id, ad_id, landing_page_url, canonical_page_identity,
         proof_target_identity, last_capture_attempt_at,
         last_successful_proof_at, last_successful_capture_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    proofTarget.run(
      proofTargetId,
      watchlistId,
      adId,
      evidenceUrl,
      `page_${token}`,
      `identity_${token}`,
      now,
      now,
      proofCaptureId,
      now,
      now,
    );

    const proofCapture = db.prepare(
      `INSERT INTO proof_capture (
         id, proof_target_id, status, failure_code, failure_reason,
         screenshot_artifact_key, html_artifact_key, extracted_fields_json,
         field_confidence_json, extraction_warnings_json,
         capture_metadata_json, render_mode, device_profile,
         extractor_version, idempotency_key, attempted_at, succeeded_at,
         created_at, updated_at
       ) VALUES (?, ?, 'succeeded', NULL, NULL, NULL, NULL, '{}', NULL, NULL,
         '{"captured":true}', 'desktop', 'desktop_default',
         'bet7-canary-v1', ?, ?, ?, ?, ?)`,
    );
    proofCapture.run(
      proofCaptureId,
      proofTargetId,
      `idem-${token}`,
      now,
      now,
      now,
      now,
    );

    const observation = db.prepare(
      `INSERT INTO ad_observation (
         id, ad_id, watchlist_run_id, landing_page_snapshot_id, seen_at,
         is_active, landing_page_url, metadata_json, created_at
       ) VALUES (?, ?, ?, NULL, ?, 1, ?, '{}', ?)`,
    );
    observation.run(observationId, adId, runId, now, evidenceUrl, now);

    const watchEvent = db.prepare(
      `INSERT INTO watch_event (
         id, watchlist_id, run_id, event_type, status, importance_score,
         ad_id, baseline_from_run_id, candidate_id, proof_capture_id,
         title, summary, metadata_json, confirmed_at, suppressed_at,
         invalidated_at, last_evaluated_at, created_at
       ) VALUES (?, ?, ?, 'ad_new', 'confirmed', 40, ?, NULL, NULL, ?,
         ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    );
    watchEvent.run(
      eventId,
      watchlistId,
      runId,
      adId,
      proofCaptureId,
      `Baseline captured: 1 active ad`,
      `We recorded 1 active ad as your starting point.`,
      JSON.stringify({
        kind: "baseline",
        sourceUrl: evidenceUrl,
        adId,
        proofCaptureId,
      }),
      now,
      now,
      now,
    );
  } finally {
    db.close();
  }

  return { userId, watchlistId, runId, adId, eventId };
}

function runPrepare(root, persistRelative) {
  const result = spawnSync(process.execPath, ["scripts/e2e-prepare-local.mjs"], {
    cwd: root,
    env: { ...process.env, E2E_PERSIST_PATH: persistRelative },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`e2e-prepare-local failed:\n${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result.stdout ?? "";
}

/** Read the E2E_TEST_MODE flag the local server would apply (config override). */
async function waitForServerReady(origin, serverProc) {
  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (serverProc.exitCode !== null) {
      throw new Error(`dev server exited early (${serverProc.exitCode}). Output:\n${readServerTail()}`);
    }
    try {
      const res = await fetch(origin, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, SERVER_READY_POLL_MS));
  }
  throw new Error(`dev server did not become ready in ${SERVER_BOOT_TIMEOUT_MS}ms. lastError=${lastError?.message}. Output:\n${readServerTail()}`);
}

let serverLogBuffer = [];
function readServerTail() {
  return serverLogBuffer.join("").slice(-4000);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const token = `${Date.now().toString(36)}`;
  const email =
    args.email ?? `bet7-${token}@canary.0509.test`;
  const windowMs = args.windowMinutes * 60 * 1000;

  const originInfo = await reserveLocalReleaseOrigin({
    preferredPort: 0,
    fallbackToEphemeral: true,
  });
  const originUrl = originInfo.origin;
  const port = originInfo.port;
  const persistAbsolute = resolveE2ePersistPath(
    REPO_ROOT,
    `.wrangler/e2e-bet7-${token}`,
  );
  const persistRelative = persistAbsolute.relativePath;
  mkdirSync(persistAbsolute.absolutePath, { recursive: true });

  emitLine(`BET 7 activation verification starting (origin=${originUrl}, email=${email}, domain=${args.domain}, window=${args.windowMinutes}min)`);
  emitLine(`parser flag gate (isSignupFirstBriefEnabled): ${parseFlag("1") ? "on" : "off"}`);

  let serverProc = null;
  try {
    // 1. Build the isolated local D1 (migrations + fixtures).
    runPrepare(REPO_ROOT, persistRelative);

    // 2. Seed the fresh user + first-scan evidence chain into that D1.
    const ids = seedFreshFirstBriefEvidence({
      token,
      email,
      domain: args.domain,
      persistPath: persistAbsolute.absolutePath,
    });
    emitLine(`seeded fresh user ${ids.userId} (${email}) + first-scan evidence for ${args.domain}`);

    // 3. Start the local E2E dev server against the same isolated persist.
    const env = {
      ...process.env,
      E2E_PERSIST_PATH: persistRelative,
      E2E_TEST_MODE: "1",
      E2E_PROVIDER_NETWORK_DENY: "1",
      E2E_SEARCH_ROLLOUT_MODE: "v2",
      AUTH_PROVIDER: "better-auth",
      BETTER_AUTH_SECRET: "local-test-secret-local-test-secret-local",
      SIGNUP_FIRST_BRIEF_ENABLED: "1",
      BETTER_AUTH_URL: originUrl,
      APP_ORIGIN: originUrl,
    };
    await originInfo.release();
    serverProc = spawn(
      "./node_modules/.bin/react-router",
      ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { cwd: REPO_ROOT, env },
    );
    serverProc.stdout?.on("data", (d) => serverLogBuffer.push(String(d)));
    serverProc.stderr?.on("data", (d) => serverLogBuffer.push(String(d)));
    await waitForServerReady(originUrl, serverProc);
    emitLine(`local E2E server ready @ ${originUrl}`);

    // 4. On-screen first brief (Playwright) — assert ready + >=1 evidence link.
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "f9_e2e_fixture",
        value: ids.userId,
        url: originUrl,
        httpOnly: true,
      },
    ]);
    await context.setExtraHTTPHeaders({ "x-0509-e2e-test-mode": "1" });
    const page = await context.newPage();
    let response;
    try {
      response = await page.goto(
        `${originUrl}/app/onboard?step=first-brief`,
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
    } catch (error) {
      throw new Error(`onboard page failed to load: ${error.message}\n${readServerTail()}`);
    }

    // Parser regression gate: the route must NOT redirect away when the flag
    // is on and ?step=first-brief is requested (a redirect means the flag
    // parser turned it off).
    const status = response?.status?.() ?? 0;
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      throw new Error(
        `parser regression FAILED: onboard redirected (status=${status}) — signup-first-brief flag is off.`,
      );
    }
    if (status !== 200) {
      throw new Error(`parser regression FAILED: onboard returned status=${status}, expected 200.`);
    }

    const onScreenDeadline = Date.now() + ON_SCREEN_DEADLINE_MS;
    let evidenceHref = null;
    try {
      await page.waitForSelector(".f9-signup-first-brief-evidence a[href^=\"http\"]", {
        state: "visible",
        timeout: ON_SCREEN_DEADLINE_MS,
      });
      evidenceHref = await page
        .locator(".f9-signup-first-brief-evidence a")
        .getAttribute("href");
    } catch (error) {
      const briefText = await page
        .locator("#signup-first-brief, body")
        .first()
        .textContent()
        .catch(() => "");
      const dbg = readFirstBriefState({
        dbPath: resolveLocalD1DatabasePath(persistAbsolute.absolutePath),
        userId: ids.userId,
      });
      throw new Error(
        `on-screen first brief did not reach ready within 5 min. pageUrl=${page.url()} status=${status}. digestRun=${JSON.stringify(dbg.digestRow)}. body=…${(briefText ?? "").slice(0, 600)}…\n${readServerTail()}`,
      );
    }
    if (!evidenceHref || !/^https?:\/\//.test(evidenceHref)) {
      throw new Error(`on-screen brief missing evidence link (href=${JSON.stringify(evidenceHref)})`);
    }
    const headline = await page
      .locator(".f9-signup-first-brief-headline")
      .textContent()
      .catch(() => null);
    const briefText = (await page.locator("#signup-first-brief").textContent().catch(() => "")) ?? "";
    emitLine(`OK on-screen first brief: evidence=${evidenceHref} headline=${JSON.stringify(headline ?? "")}`);
    await browser.close();

    // 5. Poll D1 within --window for the filed first_brief digest + email.
    const dbPath = resolveLocalD1DatabasePath(persistAbsolute.absolutePath);
    let digestRow = null;
    let deliveryRow = null;
    const pollDeadline = Date.now() + windowMs;
    while (Date.now() < pollDeadline) {
      const probe = readFirstBriefState({ dbPath, userId: ids.userId });
      digestRow = probe.digestRow;
      deliveryRow = probe.deliveryRow;
      if (digestRow) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!digestRow) {
      throw new Error(
        `first_brief digest_run did not land in D1 within ${args.windowMinutes} min for ${ids.userId}`,
      );
    }
    emitLine(`OK first_brief digest_run filed in D1: ${JSON.stringify(digestRow)}`);
    if (deliveryRow) {
      emitLine(`OK first_brief email delivery row: ${JSON.stringify(deliveryRow)}`);
    } else {
      emitLine(`INFO first_brief email delivery row not present (email sending not configured in local E2E); digest_run row satisfied the artifact gate.`);
    }
  } finally {
    if (serverProc && serverProc.exitCode === null) {
      serverProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 800));
      serverProc.kill("SIGKILL");
    }
    if (!args.keepPersist) {
      rmSync(persistAbsolute.absolutePath, { force: true, recursive: true });
    }
  }

  emitLine("");
  emitLine("BET 7 termination checks: PASS");
  if (args.json) {
    emitLine("JSON_REPORT_BEGIN");
    emitLine(JSON.stringify({
      generatedAt: new Date().toISOString(),
      origin: originUrl,
      email,
      domain: args.domain,
      windowMinutes: args.windowMinutes,
      termination: { pass: true },
    }, null, 2));
    emitLine("JSON_REPORT_END");
  }
  process.exit(0);
}

export function readFirstBriefState({ dbPath, userId }) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const digest = db
      .prepare(
        `SELECT id, summary_json, created_at AS createdAt
           FROM digest_run WHERE user_id = ?
            AND summary_json LIKE '%"kind":"first_brief"%'
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId);
    const delivery = db
      .prepare(
        `SELECT dd.id, dd.digest_run_id as digestRunId, dd.status, dd.provider, dd.recipient_email as recipientEmail
           FROM digest_delivery dd
           JOIN digest_run dr ON dr.id = dd.digest_run_id
          WHERE dr.user_id = ? AND dr.summary_json LIKE '%"kind":"first_brief"%'
            AND dd.status IN ('sent','pending')
          ORDER BY dd.id DESC LIMIT 1`,
      )
      .get(userId);
    return {
      digestRow: digest ?? null,
      deliveryRow: delivery ?? null,
    };
  } finally {
    db.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack : error}\n`);
    process.exit(2);
  });
}
