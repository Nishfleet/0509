import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("tracking role migration", () => {
  it("replaces the old role-blind active watchlist uniqueness constraint", () => {
    const migration = readFileSync("migrations/0028_tracking_roles_and_web_mentions.sql", "utf8");

    expect(migration).toContain("DROP INDEX IF EXISTS idx_watchlist_user_fingerprint_active");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_user_role_fingerprint_active");
    expect(migration).toContain("ON watchlist(user_id, tracking_role, target_fingerprint)");
    expect(migration).toContain("WHERE is_active = 1");
  });
});
