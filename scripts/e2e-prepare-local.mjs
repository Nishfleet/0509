#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
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

console.log(`local E2E D1 fixtures: ready (${persistPath.relativePath})`);
