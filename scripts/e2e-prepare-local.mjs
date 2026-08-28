#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertFixtureInvariants,
  DEFAULT_E2E_PERSIST_PATH,
  fixtureInvariantQuery,
  parseWranglerQueryOutput,
  resolveE2ePersistPath,
} from "./e2e-local-fixture.mjs";

const root = process.cwd();
const configuredPersistPath = process.env.E2E_PERSIST_PATH ?? DEFAULT_E2E_PERSIST_PATH;
const persistPath = resolveE2ePersistPath(root, configuredPersistPath);
const wrangler = path.resolve(root, "node_modules/.bin/wrangler");

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });

  if (result.status !== 0) {
    console.error(`${label}: failed`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

rmSync(persistPath.absolutePath, { force: true, recursive: true });

run("local D1 migrations", wrangler, [
  "d1",
  "migrations",
  "apply",
  "0509",
  "--local",
  "--persist-to",
  persistPath.relativePath,
]);
run("local E2E fixtures", wrangler, [
  "d1",
  "execute",
  "0509",
  "--local",
  "--persist-to",
  persistPath.relativePath,
  "--file",
  "e2e/fixtures/e2e-local.sql",
]);

const invariantOutput = run(
  "local E2E fixture invariants",
  wrangler,
  [
    "d1",
    "execute",
    "0509",
    "--local",
    "--persist-to",
    persistPath.relativePath,
    "--command",
    fixtureInvariantQuery(),
    "--json",
  ],
  { capture: true },
);
assertFixtureInvariants(parseWranglerQueryOutput(invariantOutput));

// Issue #1284: seed local R2 with the screenshot and page-text artifacts the
// e2e timeline render check follows. The landing_page_snapshot fixture row
// (e2e-timeline-nike-20260825) points at these keys; without the objects in
// R2 the screenshot link would 404 and the render check would fail.
const r2Bucket = "0509-landing-page-artifacts";
const r2KeyPrefix = "landing-pages/2026-08-25/e2e0000000000000000000000000000001";
const tmpDir = path.join(persistPath.absolutePath, "..", "e2e-r2-seed");
mkdirSync(tmpDir, { recursive: true });

// Minimal 1x1 PNG (67 bytes) — valid raster image R2 can serve as image/png.
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
const pngFile = path.join(tmpDir, "screenshot.png");
writeFileSync(pngFile, pngBytes);
run("local R2 screenshot artifact", wrangler, [
  "r2",
  "object",
  "put",
  `${r2Bucket}/${r2KeyPrefix}.png`,
  "--local",
  "--persist-to",
  persistPath.relativePath,
  "--file",
  pngFile,
  "--content-type",
  "image/png",
]);

const htmlFile = path.join(tmpDir, "page-text.html");
writeFileSync(htmlFile, "<html><body>Nike landing page proof text.</body></html>");
run("local R2 page-text artifact", wrangler, [
  "r2",
  "object",
  "put",
  `${r2Bucket}/${r2KeyPrefix}.html`,
  "--local",
  "--persist-to",
  persistPath.relativePath,
  "--file",
  htmlFile,
  "--content-type",
  "text/html; charset=utf-8",
]);

console.log(`local E2E D1 fixtures: ready (${persistPath.relativePath})`);
