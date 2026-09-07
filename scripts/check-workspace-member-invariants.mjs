#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { parseWorkspaceMembershipPreflightOutput } from "./workspace-member-preflight.lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseName = "0509";
const query = `
  SELECT COUNT(*) AS duplicate_membership_count
  FROM (
    SELECT member_user_id
    FROM workspace_member
    WHERE status = 'active' AND member_user_id IS NOT NULL
    GROUP BY member_user_id
    HAVING COUNT(*) > 1
  );
`;

const result = spawnSync(
  "wrangler",
  ["d1", "execute", databaseName, "--remote", "--command", query, "--json"],
  {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  },
);

if (result.error) {
  console.error(`workspace membership preflight could not run: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(result.stderr?.trim() || "workspace membership preflight query failed");
  process.exit(1);
}

try {
  const { duplicateMembershipCount } = parseWorkspaceMembershipPreflightOutput(
    result.stdout ?? "",
  );
  if (duplicateMembershipCount > 0) {
    console.error(
      `workspace membership preflight failed: ${duplicateMembershipCount} user(s) have duplicate active memberships. Stop; do not apply migration 0067 or deploy.`,
    );
    process.exit(1);
  }
  console.log("workspace membership preflight passed: no duplicate active memberships.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
