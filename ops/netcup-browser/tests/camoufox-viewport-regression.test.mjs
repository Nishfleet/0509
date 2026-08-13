// Camoufox health-loop regression proof.
//
// Reproduces the exact probe fault that was restarting the Camofox browser
// every ~3 minutes:
//
//   browser.newContext: Protocol error (Browser.setDefaultViewport): ...
//   Found property "<root>.viewport.isMobile" - false which is not described in this scheme
//
// The pre-fix server probe called `browser.newContext()` with NO viewport, so
// Playwright sent the default 1280x720 viewport including `isMobile: false`,
// which Camoufox's strict Juggler scheme rejects. The post-fix probe calls
// `browser.newContext({ viewport: null })`, matching every real session
// context in the server.
//
// Tests here run against the REAL Camoufox engine (camoufox-js + the
// installed binary) and the REAL installed server source, so they are red
// against the pre-fix source and green against the fixed source. They skip
// cleanly when the host paths are absent (CI portability).
//
// Env overrides:
//   CAMOUFOX_EXECUTABLE     path to the camoufox binary
//   CAMOFOX_PKG_DIR         dir containing node_modules/camoufox-js + playwright-core
//   CAMOFOX_SERVER_JS       path to the installed server.js under test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXECUTABLE = process.env.CAMOUFOX_EXECUTABLE || "/home/nish/.cache/camoufox/camoufox-bin";
const PKG_DIR = process.env.CAMOFOX_PKG_DIR || "/home/nish/.local/share/camofox-browser/1.13.1/node_modules/@askjo/camofox-browser";
const SERVER_JS = process.env.CAMOFOX_SERVER_JS || "/home/nish/.local/share/camofox-browser/1.13.1/node_modules/@askjo/camofox-browser/server.js";
const NODE_MODULES = PKG_DIR.replace(/\/@askjo\/camofox-browser$/, "");

const hostReady = existsSync(EXECUTABLE) && existsSync(`${NODE_MODULES}/camoufox-js/dist/index.js`) && existsSync(SERVER_JS);

async function launchCamoufox() {
  const { launchOptions } = await import(pathToFileURL(`${NODE_MODULES}/camoufox-js/dist/utils.js`).href);
  const mod = await import(pathToFileURL(`${NODE_MODULES}/playwright-core/index.js`).href);
  const firefox = mod.firefox ?? mod.default?.firefox;
  const options = await launchOptions({
    executable_path: EXECUTABLE,
    headless: true,
    os: "linux",
    humanize: false,
    enable_cache: false,
  });
  options.handleSIGTERM = false;
  options.handleSIGINT = false;
  options.handleSIGHUP = false;
  const browser = await firefox.launch(options);
  return browser;
}

test("PRE-FIX probe behavior: newContext() without viewport reproduces the health-loop error", { skip: !hostReady && "camoufox host paths absent" }, async () => {
  const browser = await launchCamoufox();
  try {
    // This is the exact call the broken probe made (server.js pre-fix).
    await assert.rejects(
      browser.newContext(),
      (error) => {
        const message = String(error?.message ?? "");
        return (
          message.includes("Browser.setDefaultViewport") &&
          message.includes("isMobile") &&
          message.includes("not described in this scheme")
        );
      },
      "pre-fix newContext() must fail with the viewport.isMobile scheme error",
    );
  } finally {
    await browser.close().catch(() => {});
  }
});

test("POST-FIX probe behavior: newContext({viewport:null}) + about:blank navigation succeeds", { skip: !hostReady && "camoufox host paths absent" }, async () => {
  const browser = await launchCamoufox();
  let context;
  let page;
  try {
    // This is the fixed probe call (viewport: null, like every session context).
    context = await browser.newContext({ viewport: null });
    page = await context.newPage();
    await page.goto("about:blank", { timeout: 5000 });
    assert.equal(page.url(), "about:blank");
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});

test("installed server.js probe source carries the viewport:null fix (regression against the source of truth)", { skip: !hostReady && "camoufox host paths absent" }, async () => {
  const source = await readFile(SERVER_JS, "utf8");
  // Locate the active health probe block and assert its context creation is
  // the fixed form. The probe is the ONLY newContext call site that used to
  // omit viewport: null, so the check must be anchored to the probe block.
  const probeStart = source.indexOf("// Active health probe");
  assert.ok(probeStart >= 0, "server.js must contain the active health probe block");
  const probeBlock = source.slice(probeStart, probeStart + 3000);
  const match = probeBlock.match(/browser\.newContext\(([^)]*)\)/);
  assert.ok(match, "probe must call browser.newContext");
  const args = match[1];
  assert.match(args, /viewport\s*:\s*null/, `probe newContext must pass { viewport: null }, got: ${args}`);
});

test("cheap liveness probe stays distinct: /health handler must not create browser contexts", { skip: !hostReady && "camoufox host paths absent" }, async () => {
  const source = await readFile(SERVER_JS, "utf8");
  // The /health route is a pure process-level check (no newContext/newPage).
  const healthRoute = source.slice(source.indexOf("app.get('/health'"), source.indexOf("app.get('/health'") + 4000);
  assert.ok(healthRoute.includes("res.json"), "/health must answer directly");
  assert.ok(!healthRoute.includes("newContext"), "/health must not create browser contexts");
  assert.ok(!healthRoute.includes("newPage"), "/health must not create pages");
});
