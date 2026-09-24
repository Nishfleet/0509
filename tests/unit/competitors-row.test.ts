import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #4866: /app/competitors kept its own copy of the switch's consequence and
// dimmed the whole off row to --ink-faint (2.9:1, decorative only per DESIGN.md
// §4), so a paused brand's domain and reason stopped carrying meaning. The
// route now takes the consequence from the shared BrandSwitchField and keeps
// the domain and the reason on text-ink-soft.
//
// This reads the route on disk because CompetitorItem is private to the module
// and a route module cannot be rendered without the router around it. The scan
// is source-level on purpose: the regression it guards is a className coming
// back, which is exactly what a string assertion sees. `text-ink-soft` itself
// is proved against app/app.css and DESIGN.md §4 by tests/unit/theme.test.ts.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTE = path.join(REPO_ROOT, "app/routes/app.competitors.tsx");
const DOMAIN_ROW = 'className="truncate text-body-sm text-ink-soft"';
const REASON_ROW = 'className="mt-1 text-body-sm text-ink-soft"';

describe("the /app/competitors row (#4866)", () => {
  it("prints every switch's consequence through the shared BrandSwitchField", async () => {
    const source = await readFile(ROUTE, "utf8");
    expect(source).toContain('import { BrandSwitchField } from "../components/brand-switch"');
    expect(source).toContain("<BrandSwitchField");
    expect(source).toContain("pausedOn={competitor.stateChangedAt === null ? null : new Date(competitor.stateChangedAt)}");
    expect(source).not.toContain("brandSwitchNote(");
    expect(source).not.toContain("<BrandSwitch ");
  });

  it("keeps the domain and the reason on text-ink-soft in every state", async () => {
    const source = await readFile(ROUTE, "utf8");
    expect(source).toContain(DOMAIN_ROW);
    expect(source).toContain(REASON_ROW);
  });

  it("never dims a meaningful line to ink-faint", async () => {
    const source = await readFile(ROUTE, "utf8");
    expect(source).not.toContain("ink-faint");
  });

  it("fails when an off row dims the domain back to ink-faint", async () => {
    const source = await readFile(ROUTE, "utf8");
    const dimmed = source.replace(
      DOMAIN_ROW,
      'className={cn("truncate text-body-sm", off ? "text-ink-faint" : "text-ink-soft")}',
    );
    expect(dimmed).not.toBe(source);
    expect(dimmed).toContain("ink-faint");
  });
});
