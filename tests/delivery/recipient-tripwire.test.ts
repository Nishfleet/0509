import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertSingleRecipient } from "../../workers/delivery/record";

const SKIP = new Set(["node_modules", ".git", "build", "dist", "coverage", ".wrangler", ".react-router"]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) found.push(path);
  }
  return found;
}

describe("recipient tripwire", () => {
  it("passes with one send_target", () => {
    expect(() => {
      assertSingleRecipient([{ id: "only" }]);
    }).not.toThrow();
  });

  it("fails when a workspace holds two send_target rows for one channel", () => {
    expect(() => {
      assertSingleRecipient([{ id: "first" }, { id: "second" }]);
    }).toThrow(/widen that key/);
  });

  it("keeps signal_delivery unique on the pair, not the recipient", () => {
    const sql = readFileSync("migrations/0001_rebuild.sql", "utf8");
    const start = sql.indexOf("CREATE TABLE signal_delivery");
    const end = sql.indexOf("CREATE TABLE standing");
    const table = sql.slice(start, end);
    expect(table).toContain("UNIQUE (signal_id, channel_id)");
    expect(table).not.toContain("send_target_id");
    const widened = readFileSync("migrations/0002_delivery.sql", "utf8");
    expect(widened).not.toContain("signal_delivery");
  });
});

describe("one EMAIL.send call site", () => {
  it("lives only in workers/delivery/send.ts", () => {
    const hits = sourceFiles(process.cwd()).flatMap((path) => {
      const needle = ["EMAIL", "send("].join(".");
      const count = readFileSync(path, "utf8").split(needle).length - 1;
      return count > 0 ? [{ path, count }] : [];
    });
    expect(hits).toEqual([{ path: join(process.cwd(), "workers/delivery/send.ts"), count: 1 }]);
  });
});
