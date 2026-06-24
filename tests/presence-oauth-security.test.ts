import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  consumePresenceOAuthTransaction,
  createPresenceOAuthTransaction,
  generatePkcePair,
  presenceOAuthConfigured,
  redactOAuthStateForLogs,
  signPresenceOAuthState,
  verifyPresenceOAuthState,
} from "~/lib/presence-oauth-transaction.server";

const OAUTH_SECRET = "a".repeat(32);

function createMockDb() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    prepare(sql: string) {
      const bindings: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          bindings.push(...args);
          return statement;
        },
        async run() {
          if (sql.includes("INSERT INTO presence_oauth_transaction")) {
            const [
              id,
              userId,
              workspaceUserId,
              connectorId,
              callbackUri,
              returnPath,
              pkceVerifier,
              expiresAt,
              ,
              createdAt,
            ] = bindings;
            rows.set(String(id), {
              id,
              user_id: userId,
              workspace_user_id: workspaceUserId,
              connector_id: connectorId,
              callback_uri: callbackUri,
              return_path: returnPath,
              pkce_verifier: pkceVerifier,
              expires_at: expiresAt,
              consumed_at: null,
              created_at: createdAt,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE presence_oauth_transaction")) {
            const [consumedAt, id] = bindings;
            const row = rows.get(String(id));
            if (!row || row.consumed_at || Date.parse(String(row.expires_at)) <= Date.parse(String(consumedAt))) {
              return { meta: { changes: 0 } };
            }
            row.consumed_at = consumedAt;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first<T>() {
          if (sql.includes("SELECT * FROM presence_oauth_transaction WHERE id = ?")) {
            const row = rows.get(String(bindings[0]));
            return (row ?? null) as T;
          }
          return null as T;
        },
      };
      return statement;
    },
    _rows: rows,
  };
}

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
  PRESENCE_OAUTH_STATE_SECRET: OAUTH_SECRET,
} satisfies Partial<AppEnv> as AppEnv;

describe("presence oauth transactions", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    baseEnv.DB = db as unknown as D1Database;
  });

  it("fails closed when oauth secret is missing", () => {
    const env = { ...baseEnv, PRESENCE_OAUTH_STATE_SECRET: undefined };
    expect(presenceOAuthConfigured(env)).toBe(false);
    expect(() => createPresenceOAuthTransaction(env, {
      userId: "u1",
      workspaceUserId: "u1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
      returnPath: "/app/presence",
    })).rejects.toThrow();
  });

  it("creates signed one-time transactions with PKCE", async () => {
    const created = await createPresenceOAuthTransaction(baseEnv, {
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/api/presence/oauth/linkedin/callback",
      returnPath: "/app/presence/entity-1",
    });
    expect(created.state).toContain(".");
    expect(created.pkceChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    const verified = await verifyPresenceOAuthState(baseEnv, created.state);
    expect(verified.ok).toBe(true);
  });

  it("rejects tampered state signatures", async () => {
    const created = await createPresenceOAuthTransaction(baseEnv, {
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
      returnPath: "/app/presence",
    });
    const sigStart = created.state.lastIndexOf(".") + 1;
    const sigChars = created.state.slice(sigStart).split("");
    sigChars[0] = sigChars[0] === "a" ? "b" : "a";
    const tampered = created.state.slice(0, sigStart) + sigChars.join("");
    const verified = await verifyPresenceOAuthState(baseEnv, tampered);
    expect(verified.ok).toBe(false);
  });

  it("consumes transactions once and blocks replay", async () => {
    const created = await createPresenceOAuthTransaction(baseEnv, {
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
      returnPath: "/app/presence",
    });
    const verified = await verifyPresenceOAuthState(baseEnv, created.state);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const first = await consumePresenceOAuthTransaction(baseEnv, {
      transactionId: verified.transactionId,
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
    });
    expect(first.ok).toBe(true);

    const replay = await consumePresenceOAuthTransaction(baseEnv, {
      transactionId: verified.transactionId,
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
    });
    expect(replay.ok).toBe(false);
    expect(replay.code).toBe("transaction_consumed");
  });

  it("rejects wrong user, workspace, connector, and callback", async () => {
    const created = await createPresenceOAuthTransaction(baseEnv, {
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
      returnPath: "/app/presence",
    });
    const verified = await verifyPresenceOAuthState(baseEnv, created.state);
    if (!verified.ok) throw new Error("expected valid state");

    expect(
      (await consumePresenceOAuthTransaction(baseEnv, {
        transactionId: verified.transactionId,
        userId: "other",
        workspaceUserId: "ws1",
        connectorId: "linkedin",
        callbackUri: "https://0509.io/callback",
      })).code,
    ).toBe("user_mismatch");

    expect(
      (await consumePresenceOAuthTransaction(baseEnv, {
        transactionId: verified.transactionId,
        userId: "u1",
        workspaceUserId: "other",
        connectorId: "linkedin",
        callbackUri: "https://0509.io/callback",
      })).code,
    ).toBe("workspace_mismatch");

    expect(
      (await consumePresenceOAuthTransaction(baseEnv, {
        transactionId: verified.transactionId,
        userId: "u1",
        workspaceUserId: "ws1",
        connectorId: "x",
        callbackUri: "https://0509.io/callback",
      })).code,
    ).toBe("connector_mismatch");

    expect(
      (await consumePresenceOAuthTransaction(baseEnv, {
        transactionId: verified.transactionId,
        userId: "u1",
        workspaceUserId: "ws1",
        connectorId: "linkedin",
        callbackUri: "https://evil.example/callback",
      })).code,
    ).toBe("callback_mismatch");
  });

  it("rejects expired transactions", async () => {
    const created = await createPresenceOAuthTransaction(baseEnv, {
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
      returnPath: "/app/presence",
    });
    const verified = await verifyPresenceOAuthState(baseEnv, created.state);
    if (!verified.ok) throw new Error("expected valid state");

    const row = db._rows.get(verified.transactionId);
    if (row) {
      row.expires_at = new Date(Date.now() - 60_000).toISOString();
    }

    const consumed = await consumePresenceOAuthTransaction(baseEnv, {
      transactionId: verified.transactionId,
      userId: "u1",
      workspaceUserId: "ws1",
      connectorId: "linkedin",
      callbackUri: "https://0509.io/callback",
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.code).toBe("transaction_expired");
  });

  it("generates distinct PKCE pairs", async () => {
    const first = await generatePkcePair();
    const second = await generatePkcePair();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });

  it("redacts oauth state for logs", async () => {
    const state = await signPresenceOAuthState(baseEnv, "transaction-id");
    expect(redactOAuthStateForLogs(state)).not.toContain(OAUTH_SECRET);
    expect(redactOAuthStateForLogs(state)).toContain("…");
  });
});
