import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1 } from "./helpers/sqlite-d1";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
  getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("agency"),
  checkPlanLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
  PLAN_LIMITS: { agency: { digests: true } },
}));

vi.mock("~/lib/ga-customer-surface", () => ({
  isSlackDeliveryCustomerFacing: vi.fn(() => false),
  isSlackWebhookDeliveryCustomerFacing: vi.fn(() => true),
  isTeamsWebhookDeliveryCustomerFacing: vi.fn(() => true),
  isWhatsAppDeliveryCustomerFacing: vi.fn(() => false),
  slackDeliveryUnavailableMessage: vi.fn(
    () => "Slack delivery isn’t available. Nothing was saved — use email delivery instead.",
  ),
  whatsappDeliveryUnavailableMessage: vi.fn(
    () => "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
  ),
}));

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-05-15T00:00:00.000Z",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-05-16T00:00:00.000Z",
  },
};

function createContext(env: unknown) {
  return {
    cloudflare: {
      env,
    },
  };
}

function fakeSlackWebhookUrl() {
  return new URL(
    ["services", "TSTUB", "BSTUB", "short"].join("/"),
    "https://hooks.slack.com/",
  ).toString();
}

function fakeTeamsWebhookUrl() {
  return new URL(
    ["webhookb2", "uuid@tenant", "IncomingWebhook", "uuid", "secret"].join("/"),
    "https://acme.webhook.office.com/",
  ).toString();
}

function createConfigHarness() {
  const harness = createSqliteD1();
  harness.sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT
    );
    CREATE TABLE workspace_delivery_config (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      sensitivity_mode TEXT NOT NULL CHECK (
        sensitivity_mode IN ('quiet', 'balanced', 'aggressive', 'auto')
      ) DEFAULT 'balanced',
      instant_enabled INTEGER NOT NULL DEFAULT 0,
      digest_enabled INTEGER NOT NULL DEFAULT 1,
      digest_cadence_preference TEXT NOT NULL DEFAULT 'plan_default' CHECK (
        digest_cadence_preference IN ('plan_default', 'weekly_only')
      ),
      email_enabled INTEGER NOT NULL DEFAULT 1,
      whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
      slack_enabled INTEGER NOT NULL DEFAULT 0,
      teams_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_json TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    INSERT INTO user (id, email) VALUES ('user-1', 'owner@example.com');
  `);
  return harness;
}

function seedWorkspaceDeliveryConfig(
  harness: ReturnType<typeof createConfigHarness>,
  overrides: {
    slackEnabled?: boolean;
    teamsEnabled?: boolean;
  } = {},
) {
  harness.sqlite
    .prepare(
      `
        INSERT INTO workspace_delivery_config (
          id, user_id, sensitivity_mode, instant_enabled, digest_enabled,
          digest_cadence_preference, email_enabled, whatsapp_enabled,
          slack_enabled, teams_enabled, quiet_hours_json, timezone,
          created_at, updated_at
        ) VALUES (
          'cfg-1', 'user-1', 'aggressive', 1, 1,
          'weekly_only', 0, 0,
          ?, ?, '{"startHour":22,"endHour":6}', 'Europe/Berlin',
          '2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z'
        )
      `,
    )
    .run(overrides.slackEnabled ? 1 : 0, overrides.teamsEnabled ? 1 : 0);
}

// The config a concurrent reader held BEFORE the other channel's connect
// landed — identical to the seeded row except that channel's flag.
function staleConfigSnapshot(overrides: {
  slackEnabled?: boolean;
  teamsEnabled?: boolean;
}) {
  return {
    id: "cfg-1",
    userId: "user-1",
    sensitivityMode: "aggressive" as const,
    instantEnabled: true,
    digestEnabled: true,
    digestCadencePreference: "weekly_only" as const,
    emailEnabled: false,
    whatsappEnabled: false,
    slackEnabled: overrides.slackEnabled ?? false,
    teamsEnabled: overrides.teamsEnabled ?? false,
    quietHours: { startHour: 22, endHour: 6 },
    timezone: "Europe/Berlin",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}

function readConfigRow(harness: ReturnType<typeof createConfigHarness>) {
  return harness.sqlite
    .prepare(`SELECT * FROM workspace_delivery_config WHERE user_id = 'user-1'`)
    .get() as Record<string, unknown> | undefined;
}

function ownerAuthMock(env: unknown) {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
}

async function postIntent(env: unknown, formData: FormData) {
  const { action } = await import("~/routes/app.notifications");
  return (await action({
    context: createContext(env),
    params: {},
    request: new Request("http://localhost/app/notifications", {
      method: "POST",
      body: formData,
    }),
  } as never)) as { ok: boolean; message: string };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("notifications config writes do not clobber concurrent channel flags", () => {
  it("connecting Slack does not clobber a Teams channel a concurrent save just connected", async () => {
    const harness = createConfigHarness();
    try {
      const env = { DB: harness.db as unknown as D1Database };
      ownerAuthMock(env);
      // Teams connect already landed; a concurrent reader still holds the
      // pre-connect snapshot (teamsEnabled: false).
      seedWorkspaceDeliveryConfig(harness, { teamsEnabled: true });
      const getWorkspaceDeliveryConfig = vi
        .fn()
        .mockResolvedValue(staleConfigSnapshot({ teamsEnabled: false }));
      const upsertWorkspaceDeliveryConfig = vi.fn();
      vi.doMock("~/lib/data.server", async () => {
        const actual =
          await vi.importActual<typeof import("~/lib/data.server")>(
            "~/lib/data.server",
          );
        upsertWorkspaceDeliveryConfig.mockImplementation(
          actual.upsertWorkspaceDeliveryConfig,
        );
        return {
          ...actual,
          getWorkspaceDeliveryConfig,
          upsertWorkspaceDeliveryConfig,
        };
      });
      vi.doMock("~/lib/slack.server", () => ({
        saveSlackWebhookTarget: vi.fn().mockResolvedValue({ id: "slack-t-1" }),
      }));

      const formData = new FormData();
      formData.set("intent", "save-slack-webhook");
      formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
      formData.set("slackDestinationName", "Growth alerts");
      const result = await postIntent(env, formData);

      expect(result.ok).toBe(true);
      const row = readConfigRow(harness);
      expect(row).toMatchObject({
        slack_enabled: 1,
        teams_enabled: 1,
        sensitivity_mode: "aggressive",
        instant_enabled: 1,
        digest_cadence_preference: "weekly_only",
        email_enabled: 0,
        quiet_hours_json: '{"startHour":22,"endHour":6}',
        timezone: "Europe/Berlin",
      });
      // The connect path must not round-trip the row at all: no read, no
      // whole-row upsert.
      expect(getWorkspaceDeliveryConfig).not.toHaveBeenCalled();
      expect(upsertWorkspaceDeliveryConfig).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("connecting Teams does not clobber a Slack channel a concurrent save just connected", async () => {
    const harness = createConfigHarness();
    try {
      const env = { DB: harness.db as unknown as D1Database };
      ownerAuthMock(env);
      seedWorkspaceDeliveryConfig(harness, { slackEnabled: true });
      const getWorkspaceDeliveryConfig = vi
        .fn()
        .mockResolvedValue(staleConfigSnapshot({ slackEnabled: false }));
      const upsertWorkspaceDeliveryConfig = vi.fn();
      vi.doMock("~/lib/data.server", async () => {
        const actual =
          await vi.importActual<typeof import("~/lib/data.server")>(
            "~/lib/data.server",
          );
        upsertWorkspaceDeliveryConfig.mockImplementation(
          actual.upsertWorkspaceDeliveryConfig,
        );
        return {
          ...actual,
          getWorkspaceDeliveryConfig,
          upsertWorkspaceDeliveryConfig,
        };
      });
      vi.doMock("~/lib/teams.server", () => ({
        saveTeamsWebhookTarget: vi.fn().mockResolvedValue({ id: "teams-t-1" }),
      }));

      const formData = new FormData();
      formData.set("intent", "save-teams-webhook");
      formData.set("teamsWebhookUrl", fakeTeamsWebhookUrl());
      const result = await postIntent(env, formData);

      expect(result.ok).toBe(true);
      const row = readConfigRow(harness);
      expect(row).toMatchObject({
        slack_enabled: 1,
        teams_enabled: 1,
        sensitivity_mode: "aggressive",
        instant_enabled: 1,
        digest_cadence_preference: "weekly_only",
        email_enabled: 0,
        quiet_hours_json: '{"startHour":22,"endHour":6}',
        timezone: "Europe/Berlin",
      });
      expect(getWorkspaceDeliveryConfig).not.toHaveBeenCalled();
      expect(upsertWorkspaceDeliveryConfig).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("a first connect inserts a defaults row with only the channel flag set", async () => {
    const harness = createConfigHarness();
    try {
      const env = { DB: harness.db as unknown as D1Database };
      ownerAuthMock(env);
      const getWorkspaceDeliveryConfig = vi.fn().mockResolvedValue(null);
      vi.doMock("~/lib/data.server", async () => {
        const actual =
          await vi.importActual<typeof import("~/lib/data.server")>(
            "~/lib/data.server",
          );
        return {
          ...actual,
          getWorkspaceDeliveryConfig,
          upsertWorkspaceDeliveryConfig: vi.fn(
            actual.upsertWorkspaceDeliveryConfig,
          ),
        };
      });
      vi.doMock("~/lib/slack.server", () => ({
        saveSlackWebhookTarget: vi.fn().mockResolvedValue({ id: "slack-t-1" }),
      }));

      const formData = new FormData();
      formData.set("intent", "save-slack-webhook");
      formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
      const result = await postIntent(env, formData);

      expect(result.ok).toBe(true);
      const row = readConfigRow(harness);
      expect(row).toMatchObject({
        user_id: "user-1",
        sensitivity_mode: "balanced",
        instant_enabled: 0,
        digest_enabled: 1,
        digest_cadence_preference: "plan_default",
        email_enabled: 1,
        whatsapp_enabled: 0,
        slack_enabled: 1,
        teams_enabled: 0,
        quiet_hours_json: "null",
        timezone: null,
      });
    } finally {
      harness.close();
    }
  });
});
