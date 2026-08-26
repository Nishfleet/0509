export const READINESS_ACTION_NAME = "get_workspace_readiness" as const;
export const READ_ONLY_API_KEY_REQUIREMENT = "Requires an active Agency customer API key.";
export const WRITE_ENABLED_API_KEY_REQUIREMENT = "Requires a write-enabled Agency customer API key.";
export const BROAD_WRITE_API_NON_GOAL = "broad public write APIs beyond approved account actions";

type AgentActionGroup = {
  id: string;
  label: string;
  detail: string;
  actions: readonly string[];
  requiresWriteEnabled: boolean;
  credentialRequirement: string;
};

export const AGENT_ACTION_GROUPS = [
  {
    id: "readiness",
    label: "Readiness and setup",
    detail: "Inspect the account state before changing anything.",
    actions: [READINESS_ACTION_NAME],
    requiresWriteEnabled: false,
    credentialRequirement: READ_ONLY_API_KEY_REQUIREMENT,
  },
  {
    id: "source_health",
    label: "Source health",
    detail: "Retest saved source access without exposing or replacing credentials.",
    actions: ["source.meta.retest"],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
  {
    id: "watchlists",
    label: "Watchlists",
    detail: "Create, tune, pause, resume, and refresh account-owned competitor watches.",
    actions: [
      "watchlist.create",
      "watchlist.update",
      "watchlist.refresh",
      "watchlist.pause",
      "watchlist.resume",
    ],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
  {
    id: "proof",
    label: "Evidence and reports",
    detail: "Create collections, save visible external evidence, build reports, share links, and counter-move briefs.",
    actions: [
      "collection.create",
      "proof.add_external",
      "share.create",
      "report.create",
      "report.share",
      "counter_move_brief.create",
    ],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
  {
    id: "memory",
    label: "Context and client rooms",
    detail: "Save account context and keep agency client work organized.",
    actions: [
      "memory.upsert",
      "memory.list",
      "client_room.upsert",
      "client_room.list",
    ],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
  {
    id: "support",
    label: "Support",
    detail: "Open and review account support cases without exposing private case details.",
    actions: [
      "support_case.create",
      "support_case.list",
    ],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
  {
    id: "delivery",
    label: "Delivery controls",
    detail: "Read redacted delivery targets and update existing delivery policy with explicit approval.",
    actions: [
      "delivery_targets.list",
      "delivery_settings.update",
      "delivery_target.update",
    ],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
  {
    id: "mentions",
    label: "Presence observations",
    detail: "Read existing source-backed website, blog, and Substack observations.",
    actions: ["web_mentions.list"],
    requiresWriteEnabled: true,
    credentialRequirement: WRITE_ENABLED_API_KEY_REQUIREMENT,
  },
] as const satisfies readonly AgentActionGroup[];

export type AgentCatalogActionName = (typeof AGENT_ACTION_GROUPS)[number]["actions"][number];
export type CustomerAgentActionName = Exclude<AgentCatalogActionName, typeof READINESS_ACTION_NAME>;

function isAuditedCatalogActionName(actionName: AgentCatalogActionName): actionName is CustomerAgentActionName {
  return actionName !== READINESS_ACTION_NAME;
}

export const CUSTOMER_AGENT_ACTION_NAMES = AGENT_ACTION_GROUPS
  .flatMap((group) => group.actions)
  .filter(isAuditedCatalogActionName);

export const CUSTOMER_AGENT_ACTION_NAME_SET: ReadonlySet<string> = new Set(CUSTOMER_AGENT_ACTION_NAMES);

export function isCustomerAgentActionName(actionName: string | null | undefined): actionName is CustomerAgentActionName {
  return typeof actionName === "string" && CUSTOMER_AGENT_ACTION_NAME_SET.has(actionName);
}

export const AGENT_FIRST_WORKFLOW = [
  {
    label: "Check readiness",
    detail: "Use account readiness to find missing evidence, delivery, billing, API, team, context, and client-room setup.",
  },
  {
    label: "Set up monitoring",
    detail: "Create or tune a competitor watchlist, then refresh paid watches when a human wants current evidence.",
  },
  {
    label: "Package evidence",
    detail: "Create a board, add visible external evidence when needed, build a report, and create a share link.",
  },
  {
    label: "Preserve context",
    detail: "Save account context and client-room notes so future reports and briefs inherit customer preferences.",
  },
] as const;

export const AGENT_BLOCKED_CAPABILITIES = [
  "billing changes",
  "team invites",
  "secret-bearing integration setup",
  "customer API key creation, rotation, and revocation",
	"report branding configuration and logo uploads",
  "external delivery sends",
  "unsupported-channel ingestion",
  "automated spend, reach, or impression benchmarks",
] as const;

export const CUSTOMER_SUPPORT_PATHS = [
  {
    label: "Billing changes and cancellation",
    detail: "Use Plan & billing first; support handles edge cases while portal subscription updates remain dashboard-gated.",
  },
  {
    label: "Account access and team changes",
    detail: "Use email sign-in and Team for normal access; support handles owner recovery and sensitive changes.",
  },
  {
    label: "Migration and setup help",
    detail: "Support can help move saved competitor work, delivery setup, client rooms, and reports into a working account.",
  },
  {
    label: "Security and deletion requests",
    detail: "Use the published support address for security reports, account deletion, correction, and export help.",
  },
] as const;

export function apiActionNames() {
  return [...CUSTOMER_AGENT_ACTION_NAMES];
}

export function auditedAgentActionGroups() {
  return AGENT_ACTION_GROUPS.filter((group) => group.requiresWriteEnabled);
}

export function blockedCapabilityLabels() {
  return [...AGENT_BLOCKED_CAPABILITIES];
}
