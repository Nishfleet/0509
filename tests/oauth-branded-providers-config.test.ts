import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BETTER_AUTH_OAUTH_PROVIDERS } from "../app/lib/better-auth.server";

type Vars = Record<string, unknown>;

function readWranglerVars(path: string): Vars {
  const raw = readFileSync(path, "utf8");
  // wrangler.jsonc allows // comments; strip them before parsing (same
  // comment-stripping shape as tests/search-rollout-config.test.ts).
  const withoutComments = raw
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("//");
      if (commentIndex === -1) return line;
      const before = line.slice(0, commentIndex);
      const quoteCount = (before.match(/"/g) ?? []).length;
      return quoteCount % 2 === 0 ? before : line;
    })
    .join("\n");
  const parsed = JSON.parse(withoutComments) as { vars?: Vars };
  return parsed.vars ?? {};
}

/** `wrangler secret put <KEY>` occurrences in the production deploy workflow. */
function readDeployWorkflowSecretPuts(): string[] {
  const workflowYaml = readFileSync(
    `${process.cwd()}/.github/workflows/deploy-production.yml`,
    "utf8",
  );
  return [...workflowYaml.matchAll(/wrangler secret put ([A-Z0-9_]+)/g)].map(
    (match) => match[1],
  );
}

const OAUTH_CLIENT_KEYS_BY_PROVIDER: Record<
  string,
  { clientId: string; clientSecret: string }
> = {
  google: {
    clientId: "BETTER_AUTH_GOOGLE_CLIENT_ID",
    clientSecret: "BETTER_AUTH_GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    clientId: "BETTER_AUTH_MICROSOFT_CLIENT_ID",
    clientSecret: "BETTER_AUTH_MICROSOFT_CLIENT_SECRET",
  },
};

/**
 * Committed-configuration guard for the branded OAuth allowlist.
 *
 * History this exists to prevent: issue #2404 staged
 * `BETTER_AUTH_OAUTH_BRANDED_PROVIDERS = "google"` in `wrangler.jsonc` while the
 * Google client-id/secret stayed unconfigured in production, so /auth/login and
 * /auth/signup rendered no Google button and started no Google flow. Two
 * independent outside-in audits (issue #2968) surfaced exactly that drift:
 * config advertised an intent the production surface never matched, and
 * nothing in the repo complained.
 *
 * The contract mirrors docs/auth-runtime.md and the wrangler.jsonc comment:
 * a provider may be brand-declared in `vars` ONLY when its client-id/secret
 * pair is actually synced by the production secret-sync surface. Config and
 * surface fail closed together — either the var is absent (the auth surfaces
 * show no button, matching the config), or the provider is declared AND its
 * credentials are `wrangler secret put`-ed by deploy-production.yml.
 */
describe("branded OAuth provider configuration", () => {
  it("only declares allowlisted Better Auth OAuth provider names", () => {
    const vars = readWranglerVars("wrangler.jsonc");
    const declaredVar = vars.BETTER_AUTH_OAUTH_BRANDED_PROVIDERS;

    if (declaredVar === undefined) return;

    for (const provider of String(declaredVar)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      expect(
        (BETTER_AUTH_OAUTH_PROVIDERS as readonly string[]).includes(provider),
        `BETTER_AUTH_OAUTH_BRANDED_PROVIDERS names "${provider}", which is not a Better Auth OAuth provider`,
      ).toBe(true);
    }
  });

  it("declares no OAuth provider whose secrets are not synced by the deploy workflow", () => {
    const vars = readWranglerVars("wrangler.jsonc");
    const declaredVar = vars.BETTER_AUTH_OAUTH_BRANDED_PROVIDERS;
    const syncSecretPuts = readDeployWorkflowSecretPuts();

    const declared = String(declaredVar ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    for (const provider of declared) {
      const keys = OAUTH_CLIENT_KEYS_BY_PROVIDER[provider];
      if (!keys) {
        throw new Error(
          `Provider "${provider}" is brand-declared in wrangler.jsonc but has no registered client-secret key pair in tests/oauth-branded-providers-config.test.ts — extend OAUTH_CLIENT_KEYS_BY_PROVIDER with the provider's BETTER_AUTH_*_CLIENT_ID/SECRET keys before declaring it.`,
        );
      }
      for (const key of [keys.clientId, keys.clientSecret]) {
        expect(
          syncSecretPuts,
          `${key} must be provisioned by .github/workflows/deploy-production.yml (wrangler secret put) in the rollout that declares ${provider} as a branded OAuth provider — otherwise the auth surfaces fail closed with no button, exactly the config-vs-surface drift issue #2968 removed`,
        ).toContain(key);
      }
    }

    // The immediate resolution of #2968: `google` must not reappear as a
    // declaration while BETTER_AUTH_GOOGLE_CLIENT_ID/SECRET stay unsynced.
    // Re-enable in one rollout: re-add the var AND wire the Google secret put
    // into deploy-production.yml (see the wrangler.jsonc comment and
    // docs/auth-runtime.md), then every assertion here holds by construction.
    if (!syncSecretPuts.includes(OAUTH_CLIENT_KEYS_BY_PROVIDER.google.clientId)) {
      expect(
        declared.includes("google"),
        "Google OAuth secrets are not provisioned by the deploy workflow, so BETTER_AUTH_OAUTH_BRANDED_PROVIDERS must not declare google (issue #2968 drift)",
      ).toBe(false);
    }
  });
});
