#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const REPOSITORY = "Nishfleet/0509";
const TRUSTED_WORKFLOWS = new Set([
  "deploy-production.yml",
  "d1-remote-restore-evidence.yml",
]);
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_ARTIFACT_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * @typedef {{
 *   id?: number,
 *   status?: string,
 *   conclusion?: string,
 *   head_branch?: string,
 *   head_sha?: string,
 *   created_at?: string,
 *   repository?: { full_name?: string },
 *   head_repository?: { full_name?: string },
 *   workflowFile?: string,
 * }} WorkflowRun
 */

/**
 * @typedef {{
 *   id?: number,
 *   name?: string,
 *   expired?: boolean,
 *   size_in_bytes?: number,
 *   workflow_run?: {
 *     id?: number,
 *     head_branch?: string,
 *     head_sha?: string,
 *   },
 * }} ActionsArtifact
 */

/**
 * Select only an artifact whose producing run is a completed successful main
 * run of one of the two trusted workflow files in this exact repository.
 * @param {{
 *   currentRunId: number,
 *   runs: WorkflowRun[],
 *   artifactsByRun: Record<string, ActionsArtifact[]>,
 *   repository?: string,
 * }} input
 */
export function selectRecentRemoteRestoreArtifact({
  currentRunId,
  runs,
  artifactsByRun,
  repository = REPOSITORY,
}) {
  if (
    !Number.isInteger(currentRunId) ||
    currentRunId < 1 ||
    repository !== REPOSITORY ||
    !Array.isArray(runs) ||
    !artifactsByRun ||
    typeof artifactsByRun !== "object"
  ) {
    throw new Error("remote_restore_artifact_selection_invalid");
  }
  const trustedRuns = runs
    .filter(
      (run) =>
        Number.isInteger(run?.id) &&
        Number(run.id) > 0 &&
        run.id !== currentRunId &&
        TRUSTED_WORKFLOWS.has(run?.workflowFile ?? "") &&
        run?.status === "completed" &&
        run?.conclusion === "success" &&
        run?.head_branch === "main" &&
        SHA_PATTERN.test(run?.head_sha ?? "") &&
        run?.repository?.full_name === repository &&
        run?.head_repository?.full_name === repository &&
        Number.isFinite(Date.parse(run?.created_at ?? "")),
    )
    .sort(
      (left, right) =>
        Date.parse(right.created_at ?? "") -
        Date.parse(left.created_at ?? ""),
    );

  for (const run of trustedRuns) {
    const runId = Number(run.id);
    const headSha = String(run.head_sha);
    const expectedName =
      `d1-remote-restore-evidence-${headSha}-${runId}`;
    const matches = (artifactsByRun[String(runId)] ?? []).filter(
      (artifact) =>
        Number.isInteger(artifact?.id) &&
        Number(artifact.id) > 0 &&
        artifact?.name === expectedName &&
        artifact?.expired === false &&
        artifact?.workflow_run?.id === runId &&
        artifact?.workflow_run?.head_branch === "main" &&
        artifact?.workflow_run?.head_sha === headSha,
    );
    if (matches.length === 1) {
      if (
        !Number.isInteger(matches[0].size_in_bytes) ||
        Number(matches[0].size_in_bytes) < 1 ||
        Number(matches[0].size_in_bytes) > MAX_ARTIFACT_SIZE_BYTES
      ) {
        throw new Error("remote_restore_artifact_size_invalid");
      }
      return {
        artifactId: Number(matches[0].id),
        runId,
        name: expectedName,
        sizeInBytes: Number(matches[0].size_in_bytes),
      };
    }
    if (matches.length > 1) {
      throw new Error("remote_restore_artifact_identity_ambiguous");
    }
  }
  return null;
}

/** @param {string} url @param {string} token */
async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  if (!response.ok) {
    throw new Error("remote_restore_artifact_api_failed");
  }
  return /** @type {any} */ (await response.json());
}

async function main() {
  const token = process.env.GH_TOKEN?.trim() ?? "";
  const repository = process.env.GITHUB_REPOSITORY?.trim() ?? "";
  const currentRunId = Number(process.env.GITHUB_RUN_ID);
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    repository !== REPOSITORY ||
    !Number.isInteger(currentRunId) ||
    currentRunId < 1 ||
    !token
  ) {
    throw new Error("remote_restore_artifact_context_invalid");
  }

  /** @type {WorkflowRun[]} */
  const runs = [];
  for (const workflowFile of TRUSTED_WORKFLOWS) {
    const payload = await fetchJson(
      `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?branch=main&status=success&per_page=20`,
      token,
    );
    if (!Array.isArray(payload?.workflow_runs)) {
      throw new Error("remote_restore_artifact_runs_invalid");
    }
    runs.push(
      ...payload.workflow_runs.map(
        /** @param {WorkflowRun} run */
        (run) => ({
          ...run,
          workflowFile,
        }),
      ),
    );
  }

  /** @type {Record<string, ActionsArtifact[]>} */
  const artifactsByRun = {};
  const orderedRunIds = [
    ...new Set(
      runs
        .sort(
          (left, right) =>
            Date.parse(right.created_at ?? "") -
            Date.parse(left.created_at ?? ""),
        )
        .map((run) => Number(run.id))
        .filter((runId) => Number.isInteger(runId) && runId > 0),
    ),
  ];
  for (const runId of orderedRunIds) {
    const payload = await fetchJson(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      token,
    );
    if (!Array.isArray(payload?.artifacts)) {
      throw new Error("remote_restore_artifact_list_invalid");
    }
    artifactsByRun[String(runId)] = payload.artifacts;
    const selected = selectRecentRemoteRestoreArtifact({
      currentRunId,
      runs,
      artifactsByRun,
      repository,
    });
    if (selected) {
      process.stdout.write(
        `${selected.runId}\t${selected.artifactId}\t${selected.sizeInBytes}\t${selected.name}\n`,
      );
      return true;
    }
  }
  return false;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!(await main())) {
      process.stderr.write("remote_restore_artifact_not_found\n");
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "remote_restore_artifact_failed"}\n`,
    );
    process.exitCode = 2;
  }
}
