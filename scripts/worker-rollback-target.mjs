const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** @param {unknown} input */
export function parseWorkerDeploymentStatus(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("worker_deployment_status_invalid_json");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("worker_deployment_status_invalid");
  }
  const status = /** @type {Record<string, unknown>} */ (value);
  const deploymentId = typeof status.id === "string" ? status.id.trim() : "";
  const versions = Array.isArray(status.versions) ? status.versions : [];
  if (!SAFE_IDENTIFIER_PATTERN.test(deploymentId) || versions.length !== 1) {
    throw new Error("worker_rollback_target_ambiguous");
  }
  const version = versions[0];
  if (!version || typeof version !== "object" || Array.isArray(version)) {
    throw new Error("worker_rollback_target_ambiguous");
  }
  const versionRecord = /** @type {Record<string, unknown>} */ (version);
  const versionId = typeof versionRecord.version_id === "string"
    ? versionRecord.version_id.trim()
    : "";
  if (!SAFE_IDENTIFIER_PATTERN.test(versionId) || Number(versionRecord.percentage) !== 100) {
    throw new Error("worker_rollback_target_ambiguous");
  }
  return { deploymentId, versionId, percentage: 100 };
}

/** @param {unknown} evidence @param {{ deployedVersionId?: string }} [expected] */
export function validateWorkerRollbackEvidence(evidence, expected = {}) {
  const issues = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, issues: ["worker_rollback_evidence_missing"] };
  }
  const value = /** @type {Record<string, unknown>} */ (evidence);
  if (value.schemaVersion !== 1) issues.push("worker_rollback_evidence_schema");
  if (!SAFE_IDENTIFIER_PATTERN.test(typeof value.deploymentId === "string" ? value.deploymentId : "")) {
    issues.push("worker_rollback_deployment_id");
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(typeof value.versionId === "string" ? value.versionId : "")) {
    issues.push("worker_rollback_version_id");
  }
  if (value.percentage !== 100) issues.push("worker_rollback_not_stable");
  const capturedAt = typeof value.capturedAt === "string" ? Date.parse(value.capturedAt) : Number.NaN;
  if (!Number.isFinite(capturedAt)) issues.push("worker_rollback_captured_at");
  if (value.source !== "wrangler deployments status --json") issues.push("worker_rollback_source");
  if (expected.deployedVersionId && value.versionId === expected.deployedVersionId) {
    issues.push("worker_rollback_target_matches_new_version");
  }
  return { ok: issues.length === 0, issues };
}

/** @param {string} versionId @param {string | null | undefined} [deployedVersionId] */
export function buildWorkerRollbackCommand(versionId, deployedVersionId) {
  if (!SAFE_IDENTIFIER_PATTERN.test(versionId)) {
    throw new Error("worker_rollback_version_invalid");
  }
  const deployedVersionKnown = deployedVersionId !== null && deployedVersionId !== undefined;
  if (deployedVersionKnown && !SAFE_IDENTIFIER_PATTERN.test(deployedVersionId)) {
    throw new Error("worker_rollback_version_invalid");
  }
  if (deployedVersionKnown && versionId === deployedVersionId) {
    throw new Error("worker_rollback_target_matches_new_version");
  }
  return {
    command: "wrangler",
    args: [
      "rollback",
      versionId,
      "--name",
      "0509",
      "--message",
      deployedVersionKnown
        ? `rollback failed release ${deployedVersionId}`
        : "rollback ambiguous deploy attempt",
      "--yes",
    ],
  };
}

const SAFE_DEPLOY_SHA = /^[a-f0-9]{40}$/u;
const GITHUB_API_VERSION = "2022-11-28";

/**
 * `wrangler rollback <version-id>` can only target versions still inside
 * Cloudflare's deployable window. Per-PR `wrangler versions upload` preview
 * traffic churns that window far faster than deploys do, so a target captured
 * pre-deploy can be undeployable by rollback time (run 34499830797: the
 * version still read fine, but POST /deployments rejected it with
 * "Invalid deployment: Version not found" [code 10210]).
 *
 * The retention-independent recovery is redeploying the last fully gated
 * release commit: a fresh `wrangler deploy` of that SHA creates a NEW version
 * running known-good code at 100% traffic.
 *
 * Resolve that commit as the head SHA of the most recent successful
 * deploy-production run on main.
 *
 * @param {{ repository?: string, token?: string, workflow?: string, fetchImpl?: typeof fetch }} [input]
 * @returns {Promise<string | null>}
 */
export async function resolveLastGatedReleaseSha({
  repository = process.env.GITHUB_REPOSITORY?.trim() || "Nishfleet/0509",
  token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
  workflow = "deploy-production.yml",
  fetchImpl = fetch,
} = {}) {
  const url = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs`,
  );
  url.searchParams.set("branch", "main");
  url.searchParams.set("status", "success");
  url.searchParams.set("per_page", "5");
  /** @type {Record<string, string>} */
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "0509-rollback-production",
    "x-github-api-version": GITHUB_API_VERSION,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers, redirect: "error" });
  if (!response.ok) throw new Error("github_deploy_runs_unavailable");
  const payload = await response.json();
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  for (const run of runs) {
    const sha = typeof run?.head_sha === "string" ? run.head_sha.trim() : "";
    if (SAFE_DEPLOY_SHA.test(sha)) return sha;
  }
  return null;
}

/**
 * The ordered commands that turn a release SHA back into the live Worker:
 * pin it into a scratch worktree (never touching the deploy checkout), npm ci
 * + build it there, then `wrangler deploy`. `wrangler` resolves to the
 * worktree's own pinned binary so the rollback builds with the toolchain the
 * release was cut against.
 *
 * @param {{ sha: string, worktreeDir: string, wranglerBin?: string }} input
 */
export function buildWorkerSourceRollbackSteps({ sha, worktreeDir, wranglerBin }) {
  const normalizedSha = typeof sha === "string" ? sha.trim() : "";
  if (!SAFE_DEPLOY_SHA.test(normalizedSha)) {
    throw new Error("worker_rollback_sha_invalid");
  }
  if (typeof worktreeDir !== "string" || !worktreeDir.trim()) {
    throw new Error("worker_rollback_worktree_invalid");
  }
  const wrangler =
    typeof wranglerBin === "string" && wranglerBin.trim()
      ? wranglerBin
      : `${worktreeDir}/node_modules/.bin/wrangler`;
  return [
    {
      id: "rollback_ancestor_guard",
      command: "git",
      args: ["merge-base", "--is-ancestor", normalizedSha, "HEAD"],
    },
    {
      id: "rollback_checkout_release",
      command: "git",
      args: ["worktree", "add", "--detach", worktreeDir, normalizedSha],
    },
    {
      id: "rollback_install_release",
      command: "npm",
      args: ["ci", "--ignore-scripts"],
      cwd: worktreeDir,
    },
    {
      id: "rollback_build_release",
      command: "npm",
      args: ["run", "build"],
      cwd: worktreeDir,
    },
    {
      id: "rollback_deploy_release",
      command: wrangler,
      args: ["deploy"],
      cwd: worktreeDir,
    },
  ];
}
