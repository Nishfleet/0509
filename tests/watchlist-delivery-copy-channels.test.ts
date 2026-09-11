import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

/**
 * Splits the copy statement into its INSERT column list and its SELECT list.
 * Both must name every channel column: a name only in the INSERT list gets no
 * value from the SELECT, and a list in a different order silently writes each
 * value into the wrong column.
 */
function watchlistDeliveryConfigCopySql(): {
  columns: string[];
  select: string[];
} {
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
  const sql = source.slice(start, end);

  const selectAt = sql.indexOf("SELECT");
  if (selectAt === -1) {
    throw new Error(`no SELECT in the copy statement of ${WATCHLISTS_CORE_PATH}`);
  }
  const columns = identifiers(sql.slice(0, selectAt));
  const fromAt = sql.indexOf("FROM", selectAt);
  if (fromAt === -1) {
    throw new Error(`no FROM in the copy statement of ${WATCHLISTS_CORE_PATH}`);
  }
  const select = identifiers(sql.slice(selectAt, fromAt));
  return { columns, select };
}

/** Bare column identifiers, ignoring the placeholders and the keywords. */
function identifiers(fragment: string): string[] {
  return (fragment.match(/\b[a-z][a-z0-9_]*\b/g) ?? []).filter(
    (token) => token.endsWith("_enabled"),
  );
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
  it("is a hand-written INSERT...SELECT that must list every channel column in BOTH lists", () => {
    const { columns, select } = watchlistDeliveryConfigCopySql();
    const channelColumns = schemaChannelColumns();

    // Sanity: the schema really does have the channel columns this guards,
    // so a green run cannot come from the list being empty.
    expect(channelColumns).toContain("email_enabled");
    expect(channelColumns).toContain("slack_enabled");
    expect(channelColumns).toContain("teams_enabled");

    // Both halves matter. A name present only in the INSERT column list means
    // the SELECT never supplies a value for it, so the copy still drops or
    // misaligns the channel. Checking both closes the swapped-list case, where
    // the values silently land in the wrong column.
    const missingFromColumns = channelColumns.filter(
      (column) => !columns.includes(column),
    );
    const missingFromSelect = channelColumns.filter(
      (column) => !select.includes(column),
    );

    expect(
      { missingFromColumns, missingFromSelect },
      `add ${[...new Set([...missingFromColumns, ...missingFromSelect])].join(", ")} ` +
        "to both the column list and the SELECT list of copyWatchlistDeliverySettings",
    ).toEqual({ missingFromColumns: [], missingFromSelect: [] });
  });
});
