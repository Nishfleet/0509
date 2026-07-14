import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getWorkspaceBranding,
	normalizeWorkspaceBrandLogo,
	upsertWorkspaceBranding,
	WORKSPACE_BRAND_LOGO_MAX_LENGTH,
} from "~/lib/data.server";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

function createCapturingDb(rows: unknown[] = []) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
              async all<T>() {
                return { results: rows as T[] };
              },
            };
          },
        };
      },
    },
  };
}

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

function createSqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  type SqliteBindings = Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;
  const toSqliteBindings = (bindings: unknown[]) => bindings as SqliteBindings;

  return {
    close: () => sqlite.close(),
    sqlite,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async run() {
                sqlite.prepare(sql).run(...toSqliteBindings(bindings));
                return { success: true };
              },
              async all<T>() {
                return {
                  results: sqlite.prepare(sql).all(...toSqliteBindings(bindings)) as T[],
                };
              },
            };
          },
        };
      },
    },
  };
}

function applyMigration(sqlite: DatabaseSync, path: string) {
  sqlite.exec(readFileSync(path, "utf8"));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/better-auth.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
});

describe("workspace branding persistence", () => {
  it("upserts a trimmed brand name keyed by the owner", async () => {
    const mock = createCapturingDb();

    const result = await upsertWorkspaceBranding({ DB: mock.db } as never, "user-1", {
      brandName: "  Northwind Growth  ",
    });

		expect(result).toEqual({ brandName: "Northwind Growth", brandWebsite: null, brandLogo: null });

    const upsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO workspace_branding"),
    );
    expect(upsert?.sql).toContain("ON CONFLICT(user_id) DO UPDATE");
    expect(upsert?.bindings[0]).toBe("user-1");
    expect(upsert?.bindings[1]).toBe("Northwind Growth");
    expect(upsert?.bindings[2]).toBeNull();
		expect(upsert?.bindings[3]).toBeNull();
		expect(typeof upsert?.bindings[4]).toBe("string");
  });

  it("caps the brand name at 60 characters", async () => {
    const mock = createCapturingDb();
    const longName = "A".repeat(80);

    const result = await upsertWorkspaceBranding({ DB: mock.db } as never, "user-1", {
      brandName: longName,
    });

    expect(result.brandName).toBe("A".repeat(60));
    const upsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO workspace_branding"),
    );
    expect(upsert?.bindings[1]).toBe("A".repeat(60));
  });

  it("clears branding to NULL when the brand name is empty or whitespace", async () => {
    const mock = createCapturingDb();

    const result = await upsertWorkspaceBranding({ DB: mock.db } as never, "user-1", {
      brandName: "   ",
    });

		expect(result).toEqual({ brandName: null, brandWebsite: null, brandLogo: null });
    const upsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO workspace_branding"),
    );
    expect(upsert?.bindings[1]).toBeNull();
  });

  it("reads the stored brand name for the owner and defaults to null", async () => {
    const withRow = createCapturingDb([
      {
        user_id: "user-1",
        brand_name: "Northwind Growth",
        brand_website: "https://northwind.example",
        updated_at: "2026-06-12T00:00:00.000Z",
      },
    ]);
    expect(await getWorkspaceBranding({ DB: withRow.db } as never, "user-1")).toEqual({
      brandName: "Northwind Growth",
      brandWebsite: "https://northwind.example",
			brandLogo: null,
    });

    const select = withRow.statements.find((statement) =>
      statement.sql.includes("FROM workspace_branding"),
    );
    expect(select?.sql).toContain("WHERE user_id = ?");
    expect(select?.bindings).toEqual(["user-1"]);

    const empty = createCapturingDb([]);
    expect(await getWorkspaceBranding({ DB: empty.db } as never, "user-1")).toEqual({
      brandName: null,
      brandWebsite: null,
			brandLogo: null,
    });
  });

  it("saves a brand website without changing the report brand name", async () => {
    const mock = createCapturingDb([
      {
        user_id: "user-1",
        brand_name: "Northwind Growth",
        brand_website: null,
        updated_at: "2026-06-12T00:00:00.000Z",
      },
    ]);

    const result = await upsertWorkspaceBranding({ DB: mock.db } as never, "user-1", {
      brandWebsite: "https://northwind.example",
    });

    expect(result).toEqual({
      brandName: "Northwind Growth",
      brandWebsite: "https://northwind.example",
			brandLogo: null,
    });
    const upsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO workspace_branding"),
    );
    expect(upsert?.bindings[1]).toBe("Northwind Growth");
    expect(upsert?.bindings[2]).toBe("https://northwind.example");
  });

  it("round-trips brand website through the migrated workspace branding table", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
      applyMigration(sqlite.sqlite, "migrations/0026_workspace_branding.sql");
      applyMigration(sqlite.sqlite, "migrations/0043_workspace_brand_website.sql");
			applyMigration(sqlite.sqlite, "migrations/0066_workspace_brand_logo.sql");

      expect(await getWorkspaceBranding({ DB: sqlite.db } as never, "user-1")).toEqual({
        brandName: null,
        brandWebsite: null,
				brandLogo: null,
      });

      expect(await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
        brandName: "  Northwind Growth  ",
      })).toEqual({
        brandName: "Northwind Growth",
        brandWebsite: null,
				brandLogo: null,
      });

      expect(await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
        brandWebsite: "  https://northwind.example  ",
      })).toEqual({
        brandName: "Northwind Growth",
        brandWebsite: "https://northwind.example",
				brandLogo: null,
      });

      expect(await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
        brandName: "Northwind Labs",
      })).toEqual({
        brandName: "Northwind Labs",
        brandWebsite: "https://northwind.example",
				brandLogo: null,
      });

      expect(await getWorkspaceBranding({ DB: sqlite.db } as never, "user-1")).toEqual({
        brandName: "Northwind Labs",
        brandWebsite: "https://northwind.example",
				brandLogo: null,
      });
    } finally {
      sqlite.close();
    }
  });

	it("round-trips a brand logo through the migrated workspace branding table", async () => {
		const sqlite = createSqliteD1();
    const pngLogo = `data:image/png;base64,${"A".repeat(400)}`;
		try {
			sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
			sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
			applyMigration(sqlite.sqlite, "migrations/0026_workspace_branding.sql");
			applyMigration(sqlite.sqlite, "migrations/0043_workspace_brand_website.sql");
			applyMigration(sqlite.sqlite, "migrations/0066_workspace_brand_logo.sql");

			expect(await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
				brandName: "Northwind Growth",
				brandLogo: pngLogo,
			})).toEqual({
				brandName: "Northwind Growth",
				brandWebsite: null,
				brandLogo: pngLogo,
			});

			// Logo survives an unrelated partial update.
			expect(await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
				brandWebsite: "https://northwind.example",
			})).toEqual({
				brandName: "Northwind Growth",
				brandWebsite: "https://northwind.example",
				brandLogo: pngLogo,
			});

			expect(await getWorkspaceBranding({ DB: sqlite.db } as never, "user-1")).toEqual({
				brandName: "Northwind Growth",
				brandWebsite: "https://northwind.example",
				brandLogo: pngLogo,
			});

			// Explicit null clears the stored logo.
			expect(await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
				brandLogo: null,
			})).toEqual({
				brandName: "Northwind Growth",
				brandWebsite: "https://northwind.example",
				brandLogo: null,
			});
		} finally {
			sqlite.close();
		}
	});
});

describe("workspace brand logo normalizer", () => {
	it("accepts small PNG, JPEG, and WebP data URLs", () => {
		const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
		const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
		const webp = "data:image/webp;base64,UklGRhoAAABXRUJQ";

		expect(normalizeWorkspaceBrandLogo(png)).toBe(png);
		expect(normalizeWorkspaceBrandLogo(jpeg)).toBe(jpeg);
		expect(normalizeWorkspaceBrandLogo(webp)).toBe(webp);
    expect(normalizeWorkspaceBrandLogo(`  ${png}  `)).toBe(png);
	});

	it("rejects SVG data URLs (stored-XSS vector)", () => {
		expect(
			normalizeWorkspaceBrandLogo("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cCI+PC9zdmc+"),
		).toBeNull();
		expect(
			normalizeWorkspaceBrandLogo("data:image/svg+xml,<svg onload=alert(1)></svg>"),
		).toBeNull();
	});

	it("rejects non-data-URL and non-base64 payloads", () => {
		expect(normalizeWorkspaceBrandLogo("https://cdn.example/logo.png")).toBeNull();
		expect(normalizeWorkspaceBrandLogo("data:image/png;base64,")).toBeNull();
		expect(normalizeWorkspaceBrandLogo('data:image/png;base64,abc"><script>')).toBeNull();
		expect(normalizeWorkspaceBrandLogo("data:text/html;base64,PGh0bWw+")).toBeNull();
		expect(normalizeWorkspaceBrandLogo("")).toBeNull();
		expect(normalizeWorkspaceBrandLogo(null)).toBeNull();
		expect(normalizeWorkspaceBrandLogo(undefined)).toBeNull();
	});

	it("rejects logos over the encoded size cap", () => {
		const prefix = "data:image/png;base64,";
    const oversized = `${prefix}${"A".repeat(WORKSPACE_BRAND_LOGO_MAX_LENGTH - prefix.length + 4)}`;
    const atCap = `${prefix}${"A".repeat(WORKSPACE_BRAND_LOGO_MAX_LENGTH - prefix.length)}`;

		expect(normalizeWorkspaceBrandLogo(oversized)).toBeNull();
		expect(normalizeWorkspaceBrandLogo(atCap)).toBe(atCap);
	});

	it("nulls out an invalid logo on upsert instead of storing it", async () => {
		const mock = createCapturingDb();

		const result = await upsertWorkspaceBranding({ DB: mock.db } as never, "user-1", {
			brandLogo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		});

		expect(result.brandLogo).toBeNull();
		const upsert = mock.statements.find((statement) =>
			statement.sql.includes("INSERT INTO workspace_branding"),
		);
		expect(upsert?.bindings[3]).toBeNull();
	});
});

describe("account report-branding action", () => {
  it.each([
    ["revoke-session", { sessionId: "session-other" }],
    ["revoke-other-sessions", {}],
  ])("blocks %s for local E2E fixture sessions", async (intent, extraFields) => {
    const fixtureSession = {
      ...session,
      session: {
        ...session.session,
        id: "e2e-session-e2e-starter",
      },
    };
    const revokeBetterAuthSessionById = vi.fn();
    const revokeOtherBetterAuthSessions = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(fixtureSession),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      revokeBetterAuthSessionById,
      revokeOtherBetterAuthSessions,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", intent);
    for (const [key, value] of Object.entries(extraFields)) {
      formData.set(key, value);
    }

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent,
      message: "Sign in with email to manage active sessions.",
    });
    expect(revokeBetterAuthSessionById).not.toHaveBeenCalled();
    expect(revokeOtherBetterAuthSessions).not.toHaveBeenCalled();
  });

  it("blocks account deletion requests for local E2E fixture sessions", async () => {
    const fixtureSession = {
      ...session,
      session: {
        ...session.session,
        id: "e2e-session-e2e-starter",
      },
    };
    const createSupportCase = vi.fn();
    const getUserPlanBillingInfo = vi.fn();
    const sendOperatorAlertEmail = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(fixtureSession),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createSupportCase,
      getUserPlanBillingInfo,
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      sendOperatorAlertEmail,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "request-account-deletion");
    formData.set("confirmDeletion", "yes");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "request-account-deletion",
      message: "Sign in with email to request account deletion.",
    });
    expect(getUserPlanBillingInfo).not.toHaveBeenCalled();
    expect(createSupportCase).not.toHaveBeenCalled();
    expect(sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it("rejects branding saves for non-agency plans", async () => {
    const upsertWorkspaceBrandingMock = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: upsertWorkspaceBrandingMock,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "save-report-branding");
    formData.set("brandName", "Northwind Growth");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "save-report-branding",
      error: "plan_gated",
      message: "Branded reports are part of Agency.",
    });
    expect(upsertWorkspaceBrandingMock).not.toHaveBeenCalled();
  });

  it("saves branding for agency plans", async () => {
    const upsertWorkspaceBrandingMock = vi
      .fn()
      .mockResolvedValue({ brandName: "Northwind Growth", brandWebsite: null });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("agency"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: upsertWorkspaceBrandingMock,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "save-report-branding");
    formData.set("brandName", "Northwind Growth");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(upsertWorkspaceBrandingMock).toHaveBeenCalledWith(expect.anything(), "user-1", {
      brandName: "Northwind Growth",
    });
    expect(result).toEqual({
      ok: true,
      intent: "save-report-branding",
      message: 'Saved. Shared reports now open with "Prepared by Northwind Growth".',
    });
  });

  it("saves the own-brand website on any plan", async () => {
    const upsertWorkspaceBrandingMock = vi
      .fn()
      .mockResolvedValue({ brandName: null, brandWebsite: "https://northwind.example" });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: upsertWorkspaceBrandingMock,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "save-brand-profile");
    formData.set("brandWebsite", "northwind.example");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(upsertWorkspaceBrandingMock).toHaveBeenCalledWith(expect.anything(), "user-1", {
      brandWebsite: "https://northwind.example",
    });
    expect(result).toEqual({
      ok: true,
      intent: "save-brand-profile",
      message: "Saved your brand website.",
    });
  });

  it("rejects an invalid own-brand website without saving", async () => {
    const upsertWorkspaceBrandingMock = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: upsertWorkspaceBrandingMock,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "save-brand-profile");
    formData.set("brandWebsite", "samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "save-brand-profile",
      error: "invalid_brand_website",
      message: "That website looks incomplete. Add the full domain, like brand.com.",
    });
    expect(upsertWorkspaceBrandingMock).not.toHaveBeenCalled();
  });

  it("blocks account deletion requests while billing is active", async () => {
    const createSupportCase = vi.fn();
    vi.doMock("~/lib/auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
      return {
        ...actual,
        requireSession: vi.fn().mockResolvedValue(session),
        requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
          session,
          workspaceUserId: session.user.id,
          isMember: false,
          ownerName: null,
        })),
      };
    });
    vi.doMock("~/lib/data.server", () => ({
      createSupportCase,
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        dodoCustomerId: "cus_123",
        dodoNextBillingAt: null,
        dodoProductId: "prod_123",
        dodoStatus: "active",
        dodoSubscriptionId: "sub_123",
        plan: "agency",
        planUpdatedAt: null,
      }),
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "request-account-deletion");
    formData.set("confirmDeletion", "yes");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "request-account-deletion",
      message:
        "Your subscription is still active. Start cancellation from Plan & billing or open a billing support case first - you keep access until the end of the period you've paid for, and can delete the account after that.",
    });
    expect(createSupportCase).not.toHaveBeenCalled();
  });

  it("opens and notifies a support case for free-plan account deletion requests", async () => {
    const createSupportCase = vi.fn().mockResolvedValue({
      alreadyExists: false,
      id: "case-delete-1",
      updatedAt: "2026-06-28T17:30:00.000Z",
    });
    const createSupportCaseEvent = vi.fn().mockResolvedValue(null);
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
      return {
        ...actual,
        requireSession: vi.fn().mockResolvedValue(session),
        requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
          session,
          workspaceUserId: session.user.id,
          isMember: false,
          ownerName: null,
        })),
      };
    });
    vi.doMock("~/lib/data.server", () => ({
      createSupportCase,
      createSupportCaseEvent,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        dodoCustomerId: null,
        dodoNextBillingAt: null,
        dodoProductId: null,
        dodoStatus: null,
        dodoSubscriptionId: null,
        plan: "free",
        planUpdatedAt: null,
      }),
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      sendOperatorAlertEmail,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "request-account-deletion");
    formData.set("confirmDeletion", "yes");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(createSupportCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      category: "security",
      priority: "urgent",
      subject: "Delete my Five to Nine account",
      detail: expect.stringContaining("owner@example.com"),
      context: {
        createdFrom: "signed_in_account_deletion_request",
        source: "app.account",
      },
      reopenClosed: true,
      requestKey: "account-deletion:user-1",
    });
    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: "support-case:case-delete-1",
      subject: "0509 account deletion request",
    }));
    expect(createSupportCaseEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      caseId: "case-delete-1",
      eventType: "support_notified",
      userId: "user-1",
    }));
    expect(result).toEqual({
      ok: true,
      intent: "request-account-deletion",
      message:
        "Deletion request opened as case case-delete-1. We will verify by email before anything is deleted.",
    });
  });

  it("uses a fresh notification key for reopened account deletion cases", async () => {
    const createSupportCase = vi.fn().mockResolvedValue({
      alreadyExists: false,
      id: "case-delete-1",
      reopened: true,
      updatedAt: "2026-06-28T17:30:00.000Z",
    });
    const sendOperatorAlertEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
      return {
        ...actual,
        requireSession: vi.fn().mockResolvedValue(session),
        requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
          session,
          workspaceUserId: session.user.id,
          isMember: false,
          ownerName: null,
        })),
      };
    });
    vi.doMock("~/lib/data.server", () => ({
      createSupportCase,
      createSupportCaseEvent: vi.fn().mockResolvedValue(null),
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        dodoCustomerId: null,
        dodoNextBillingAt: null,
        dodoProductId: null,
        dodoStatus: null,
        dodoSubscriptionId: null,
        plan: "free",
        planUpdatedAt: null,
      }),
      getWorkspaceBranding: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      sendOperatorAlertEmail,
    }));

    const { action } = await import("~/routes/app.account");
    const formData = new FormData();
    formData.set("intent", "request-account-deletion");
    formData.set("confirmDeletion", "yes");

    await action({
      context: createContext(),
      request: new Request("http://localhost/app/account", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: "support-case-reopen:case-delete-1:2026-06-28T17:30:00.000Z",
    }));
  });
});
