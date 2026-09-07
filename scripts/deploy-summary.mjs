#!/usr/bin/env node
import { appendFileSync } from "node:fs";

// 0509#1577 accept 3: a `deploy: auto` line in the GitHub Actions run
// summary so the fleet console DEPLOY tile can read the last auto-deploy
// mode and time. Push-triggered deploys write `deploy: auto`; manual
// workflow_dispatch deploys write `deploy: manual`. No-op outside Actions
// (GITHUB_STEP_SUMMARY unset), so local break-glass deploys are unaffected.

/**
 * @typedef {Object} DeploySummaryOptions
 * @property {string} [eventName]   - GitHub Actions event name (`push` or `workflow_dispatch`).
 * @property {string} [summaryPath] - Path to $GITHUB_STEP_SUMMARY; empty/undefined outside Actions.
 * @property {string} [timestamp]   - ISO 8601 timestamp of the deploy.
 */

/**
 * @param {DeploySummaryOptions} [options]
 * @returns {{ mode: string, timestamp: string } | null}
 */
export function writeDeploySummary({
  eventName = process.env.GITHUB_EVENT_NAME || "",
  summaryPath = process.env.GITHUB_STEP_SUMMARY || "",
  timestamp = new Date().toISOString(),
} = {}) {
  if (!summaryPath) {
    return null;
  }
  const mode = eventName === "push" ? "auto" : "manual";
  const line = `deploy: ${mode} (${timestamp})\n`;
  appendFileSync(summaryPath, line);
  return { mode, timestamp };
}
