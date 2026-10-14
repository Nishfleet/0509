import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app/components", "app/routes", "app/lib/delivery-address.server.ts", "app/lib/error-copy.ts"];

function files(path: string): string[] {
  if (/\.tsx?$/.test(path)) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() || /\.tsx?$/.test(entry.name) ? files(join(path, entry.name)) : [],
  );
}

describe("what people read says couldn't and can't, like the rest of the app", () => {
  it("has no formal could not or cannot in screen copy", () => {
    const offenders = ROOTS.flatMap(files).filter((file) =>
      /\b(We could not|could not be shown|You cannot|We cannot)\b/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
