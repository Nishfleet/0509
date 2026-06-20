export const AGENT_ACTION_GROUPS = [
  {
    id: "readiness",
    label: "Readiness and setup",
    detail: "Inspect the account state before changing anything.",
    actions: ["get_workspace_readiness"],
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
  },
  {
    id: "proof",
    label: "Proof and reports",
    detail: "Create boards, save visible external proof, build reports, share links, and counter-move briefs.",
    actions: [
      "collection.create",
      "proof.add_external",
      "share.create",
      "report.create",
      "report.share",
      "counter_move_brief.create",
    ],
  },
  {
    id: "memory",
    label: "Memory and client rooms",
    detail: "Save account context and keep agency client work organized.",
    actions: [
      "memory.upsert",
      "memory.list",
      "client_room.upsert",
      "client_room.list",
    ],
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
  },
  {
    id: "mentions",
    label: "Web mentions beta",
    detail: "Read existing proof-backed web, blog, Substack, and Reddit observations.",
    actions: ["web_mentions.list"],
  },
] as const;

export const CUSTOMER_AGENT_ACTION_NAMES = AGENT_ACTION_GROUPS
  .flatMap((group) => group.actions)
  .filter((actionName) => actionName !== "get_workspace_readiness") as CustomerAgentActionName[];

export type CustomerAgentActionName =
  | "watchlist.create"
  | "watchlist.update"
  | "watchlist.refresh"
  | "watchlist.pause"
  | "watchlist.resume"
  | "collection.create"
  | "proof.add_external"
  | "share.create"
  | "report.create"
  | "report.share"
  | "counter_move_brief.create"
  | "memory.upsert"
  | "memory.list"
  | "client_room.upsert"
  | "client_room.list"
  | "delivery_targets.list"
  | "delivery_settings.update"
  | "delivery_target.update"
  | "web_mentions.list";

export const CUSTOMER_AGENT_ACTION_NAME_SET = new Set<CustomerAgentActionName>(CUSTOMER_AGENT_ACTION_NAMES);

export const AGENT_FIRST_WORKFLOW = [
  {
    label: "Check readiness",
    detail: "Use workspace readiness to find missing proof, delivery, billing, API, team, memory, and client-room setup.",
  },
  {
    label: "Set up monitoring",
    detail: "Create or tune a competitor watchlist, then refresh paid watches when a human wants current proof.",
  },
  {
    label: "Package proof",
    detail: "Create a board, add visible external proof when needed, build a report, and create a share link.",
  },
  {
    label: "Preserve context",
    detail: "Save account memory and client-room context so future reports and briefs inherit customer preferences.",
  },
] as const;

export const AGENT_BLOCKED_CAPABILITIES = [
  "billing changes",
  "team invites",
  "secret-bearing integration setup",
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
    detail: "Use Stytch sign-in and Team for normal access; support handles owner recovery and sensitive changes.",
  },
  {
    label: "Migration and setup help",
    detail: "Support can help move saved competitor work, Slack delivery, client rooms, and reports into a working account.",
  },
  {
    label: "Security and deletion requests",
    detail: "Use the published support address for security reports, account deletion, correction, and export help.",
  },
] as const;

export function apiActionNames() {
  return [...CUSTOMER_AGENT_ACTION_NAMES];
}

export function blockedCapabilityLabels() {
  return [...AGENT_BLOCKED_CAPABILITIES];
}
