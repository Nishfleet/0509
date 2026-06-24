import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("presence tracking migration", () => {
  it("defines unified entity tables with encrypted connection storage", () => {
    const migration = readFileSync("migrations/0055_presence_tracking.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS tracked_entity");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS source_target");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS source_connection");
    expect(migration).toContain("encrypted_credentials");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS presence_item");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS presence_poll_cursor");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS presence_entity_link");
  });

  it("defines oauth transaction table for one-time state", () => {
    const migration = readFileSync("migrations/0056_presence_oauth_transaction.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS presence_oauth_transaction");
    expect(migration).toContain("pkce_verifier");
    expect(migration).toContain("consumed_at");
  });
});
