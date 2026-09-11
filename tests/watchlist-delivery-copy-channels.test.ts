import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

/**
 * `copyWatchlistDeliverySettings` (app/lib/data/watchlists-core.server.ts) is a
 * hand-written `INSERT INTO watchlist_delivery_config ... SELECT` that lists
 * the columns it carries over when a watchlist is retargeted (competitor
 * rebrand / domain change -> new `targetFingerprint`).
 *
 * Being hand-written, it silently drops any column a later migration adds.
 * That already happened once: 0019 added `slack_enabled` and the copy was
 * updated, 0075 added `teams_enabled` and the copy was not, so retargeting
 * reset Teams alerts to the schema default 0 while email and digest kept
 * working (issue #2432).
 *
 * A hand-maintained test list would rot the same way, so this derives the
 * columns from the live schema: it replays the real migration chain and
 * asserts the copy carries every `*_enabled` channel column that
 * `watchlist_delivery_config` actually has. The next channel migration fails
 * here until the copy is taught the new column.
 */
const WATCHLISTS_CORE_PATH = "app/lib/data/watchlists-core.server.ts";

function watchlistDeliveryConfigSql(): string {
  const source = readFileSync(WATCHLISTS_CORE_PATH, "utf8");
  const start = source.indexOf("INSERT INTO watchlist_delivery_config");
  if (start === -1) {
    throw new Error(
      `no "INSERT INTO watchlist_delivery_config" found in ${WATCHLISTS_CORE_PATH}`,
    );
  }
  // The statement ends at the closing backtick of its template literal.
  const end = source.indexOf("`", start);
  if (end === -1) {
    throw new Error(
      `unterminated SQL template literal after ${start} in ${WATCHLISTS_CORE_PATH}`,
    );
  }
  return source.slice(start, end);
}

function schemaChannelColumns(): string[] {
  const { sqlite, close } = createSqliteD1();
  try {
    for (const file of readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      applyMigration(sqlite, `migrations/${file}`);
    }
    const columns = sqlite
      .prepare("PRAGMA table_info(watchlist_delivery_config)")
      .all() as Array<{ name: string }>;
    return columns
      .map((column) => column.name)
      .filter((name) => name.endsWith("_enabled"));
  } finally {
    close();
  }
}

describe("copyWatchlistDeliverySettings", () => {
  const databases: ReturnType<typeof createSqliteD1>[] = [];
  afterEach(() => {
    while (databases.length > 0) {
      databases.pop()?.close();
    }
  });

  it("is a hand-written INSERT...SELECT that must list every channel column", () => {
    const sql = watchlistDeliveryConfigSql();
    const channelColumns = schemaChannelColumns();

    // Sanity: the schema really does have the channel columns this guards,
    // so a green run cannot come from the list being empty.
    expect(channelColumns).toContain("email_enabled");
    expect(channelColumns).toContain("slack_enabled");
    expect(channelColumns).toContain("teams_enabled");

    const missing = channelColumns.filter((column) => !sql.includes(column));
    expect(missing).toEqual([]);
  });
});
