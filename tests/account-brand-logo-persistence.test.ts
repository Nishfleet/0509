import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWorkspaceBranding,
  normalizeWorkspaceBrandLogo,
  upsertWorkspaceBranding,
  WORKSPACE_BRAND_LOGO_MAX_LENGTH,
} from "~/lib/data.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("workspace brand logo persistence", () => {
  it("preserves concurrent partial website and logo updates atomically", async () => {
    const sqlite = createSqliteD1();
    const pngLogo = `data:image/png;base64,${"A".repeat(400)}`;
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
      applyMigration(sqlite.sqlite, "migrations/0026_workspace_branding.sql");
      applyMigration(sqlite.sqlite, "migrations/0043_workspace_brand_website.sql");
      applyMigration(sqlite.sqlite, "migrations/0066_workspace_brand_logo.sql");

      await upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
        brandName: "Northwind Growth",
      });
      await Promise.all([
        upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
          brandWebsite: "https://northwind.example",
        }),
        upsertWorkspaceBranding({ DB: sqlite.db } as never, "user-1", {
          brandLogo: pngLogo,
        }),
      ]);

      expect(await getWorkspaceBranding({ DB: sqlite.db } as never, "user-1")).toEqual({
        brandName: "Northwind Growth",
        brandWebsite: "https://northwind.example",
        brandLogo: pngLogo,
      });
    } finally {
      sqlite.close();
    }
  });

  it("round-trips a brand logo and explicit removal through the migrated table", async () => {
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
      })).toEqual({ brandName: "Northwind Growth", brandWebsite: null, brandLogo: pngLogo });

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

  it("preserves pre-existing branding when migration 0066 adds the logo column", () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
      applyMigration(sqlite.sqlite, "migrations/0026_workspace_branding.sql");
      applyMigration(sqlite.sqlite, "migrations/0043_workspace_brand_website.sql");
      sqlite.sqlite.exec(
        "INSERT INTO workspace_branding (user_id, brand_name, brand_website, updated_at) VALUES ('user-1', 'Northwind Growth', 'https://northwind.example', '2026-06-12T00:00:00.000Z')",
      );
      applyMigration(sqlite.sqlite, "migrations/0066_workspace_brand_logo.sql");

      expect(
        sqlite.sqlite
          .prepare("SELECT brand_name, brand_website, brand_logo FROM workspace_branding WHERE user_id = ?")
          .get("user-1"),
      ).toEqual({
        brand_name: "Northwind Growth",
        brand_website: "https://northwind.example",
        brand_logo: null,
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

  it("rejects SVG, remote, malformed, and non-base64 payloads", () => {
    expect(normalizeWorkspaceBrandLogo("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cCI+PC9zdmc+")).toBeNull();
    expect(normalizeWorkspaceBrandLogo("data:image/svg+xml,<svg onload=alert(1)></svg>")).toBeNull();
    expect(normalizeWorkspaceBrandLogo("https://cdn.example/logo.png")).toBeNull();
    expect(normalizeWorkspaceBrandLogo("data:image/png;base64,")).toBeNull();
    expect(normalizeWorkspaceBrandLogo('data:image/png;base64,abc"><script>')).toBeNull();
    expect(normalizeWorkspaceBrandLogo("data:text/html;base64,PGh0bWw+")).toBeNull();
    expect(normalizeWorkspaceBrandLogo("")).toBeNull();
    expect(normalizeWorkspaceBrandLogo(null)).toBeNull();
    expect(normalizeWorkspaceBrandLogo(undefined)).toBeNull();
  });

  it("enforces the encoded size cap and nulls invalid upserts", async () => {
    const prefix = "data:image/png;base64,";
    const oversized = `${prefix}${"A".repeat(WORKSPACE_BRAND_LOGO_MAX_LENGTH - prefix.length + 4)}`;
    const atCap = `${prefix}${"A".repeat(WORKSPACE_BRAND_LOGO_MAX_LENGTH - prefix.length)}`;
    expect(normalizeWorkspaceBrandLogo(oversized)).toBeNull();
    expect(normalizeWorkspaceBrandLogo(atCap)).toBe(atCap);

    const mock = createCapturingDb([
      { user_id: "user-1", brand_name: null, brand_website: null, brand_logo: null, updated_at: "2026-06-12T00:00:00.000Z" },
    ]);
    const result = await upsertWorkspaceBranding({ DB: mock.db } as never, "user-1", {
      brandLogo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    });
    expect(result.brandLogo).toBeNull();
    const upsert = mock.statements.find((statement) => statement.sql.includes("INSERT INTO workspace_branding"));
    expect(upsert?.bindings[3]).toBeNull();
  });
});
