const MANIFEST_PATH_PATTERN = /^test-results\/deploy-readiness-[a-z0-9-]{1,96}\.json$/u;

/**
 * @typedef {{
 *   id: string;
 *   command: string;
 *   args: string[];
 *   env?: Record<string, string>;
 *   includeCloudflareCredentials?: boolean;
 * }} ProductionDeployStep
 */

/** @param {{ manifestPath: string }} input @returns {ProductionDeployStep[]} */
export function buildProductionDeployPlan({ manifestPath }) {
  if (typeof manifestPath !== "string" || !MANIFEST_PATH_PATTERN.test(manifestPath)) {
    throw new Error("invalid_deploy_readiness_manifest_path");
  }

  return [
    {
      id: "public_source_truth",
      command: "node",
      args: ["scripts/check-public-home-current.mjs", "--source-only"],
    },
    {
      id: "workspace_membership_preflight",
      command: "node",
      args: ["scripts/check-workspace-member-invariants.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "migration_sync",
      command: "node",
      args: ["scripts/check-d1-migrations-synced.mjs"],
      includeCloudflareCredentials: true,
    },
    {
      id: "launch_readiness",
      command: "npm",
      args: ["run", "launch:readiness"],
      env: {
        E2E_RELEASE_BASE: "HEAD",
        E2E_RELEASE_MANIFEST_PATH: manifestPath,
      },
    },
    {
      id: "readiness_evidence",
      command: "node",
      args: [
        "scripts/verify-deploy-readiness.mjs",
        "--manifest",
        manifestPath,
        "--base",
        "HEAD",
      ],
    },
    {
      id: "public_runtime_truth",
      command: "node",
      args: ["scripts/check-public-home-current.mjs"],
    },
    {
      id: "deploy",
      command: "wrangler",
      args: ["deploy"],
      includeCloudflareCredentials: true,
    },
    {
      id: "live_public_truth",
      command: "node",
      args: ["scripts/check-live-public-home.mjs"],
    },
    {
      id: "oauth_branding",
      command: "node",
      args: ["scripts/check-google-oauth-branding.mjs"],
    },
  ];
}

/**
 * @param {ProductionDeployStep[]} plan
 * @param {(step: ProductionDeployStep) => void} execute
 */
export function executeProductionDeployPlan(plan, execute) {
  if (!Array.isArray(plan) || typeof execute !== "function") {
    throw new Error("invalid_production_deploy_plan");
  }
  for (const step of plan) execute(step);
}
