/**
 * Workspace domain barrel (user / branding / ops aggregates / launch
 * readiness). Product code should keep importing from `~/lib/data.server`
 * until later migration PRs.
 */

export {
  getOldestUserId,
  getUserIdByEmail,
  completeUserOnboarding,
  listSavedQueries,
  getSavedQuery,
  createSavedQuery,
  touchSavedQueryRun,
} from "~/lib/data/workspace-user.server";

export {
  WORKSPACE_BRAND_NAME_MAX_LENGTH,
  WORKSPACE_BRAND_WEBSITE_MAX_LENGTH,
	WORKSPACE_BRAND_LOGO_MAX_LENGTH,
  getWorkspaceBranding,
	normalizeWorkspaceBrandLogo,
  upsertWorkspaceBranding,
} from "~/lib/data/workspace-branding.server";

export {
  type OperatorRiskSummary,
  type WeeklyBusinessSummary,
  getWeeklyBusinessSummary,
  getOperatorRiskSummary,
  getOperatorSnapshot,
  getOperatorSupportCase,
} from "~/lib/data/workspace-ops.server";

export {
  logMetaIntegrationStatus,
  getMetaIntegrationStatus,
  getLaunchReadinessSignals,
} from "~/lib/data/workspace-launch.server";
