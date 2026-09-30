import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROUTES = join(import.meta.dirname, "../../app/routes");
const EXEMPT = new Set(["app-layout.tsx", "app-settings-layout.tsx", "unmatched.tsx"]);

describe("route titles", () => {
  it("gives every page route a meta function, so no tab or screen reader hears an untitled page", () => {
    const missing = readdirSync(ROUTES)
      .filter((file) => file.endsWith(".tsx") && !EXEMPT.has(file))
      .filter((file) => !readFileSync(join(ROUTES, file), "utf8").includes("export function meta"));
    expect(missing).toEqual([]);
  });
});
