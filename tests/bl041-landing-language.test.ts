import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { shellTopbarIsSuppressed } from "~/routes/app-layout";

const css = readFileSync("app/app.css", "utf8");
const team = readFileSync("app/routes/app.team.tsx", "utf8");
const billing = readFileSync("app/routes/app.billing.tsx", "utf8");
const account = readFileSync("app/routes/app.account.tsx", "utf8");
const MARKER = "/* === BL-041 team, billing, and account (landing language) === */";

function layer() {
  const index = css.indexOf(MARKER);
  expect(index).toBeGreaterThan(0);
  return css.slice(index);
}

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("BL-041 landing-language settings layer", () => {
  it("is the one final appended CSS section and scopes all three routes", () => {
    expect(css.match(new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(layer().slice(MARKER.length)).not.toMatch(/\/\* === BL-0\d{2}/);
    for (const source of [team, billing, account]) {
      expect(source).toContain("f9-bl041-page");
      expect(source).toContain("f9-wk-page");
      expect(source).toContain("<WorkingHeader");
      expect(source).not.toContain("<DashboardPageHeader");
    }
  });

  it("suppresses the legacy shell topbar on all three working-header routes", () => {
    for (const pathname of ["/app/team", "/app/billing", "/app/account"]) {
      expect(shellTopbarIsSuppressed(pathname)).toBe(true);
      expect(shellTopbarIsSuppressed(`${pathname}/`)).toBe(true);
    }
    expect(shellTopbarIsSuppressed("/app/teams")).toBe(false);
  });

  it("uses one 1px rule weight and square geometry", () => {
    const section = stripComments(layer());
    const widths = new Set<string>();
    for (const match of section.matchAll(
      /border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?:\s*([^;]+);/g,
    )) {
      const value = match[1].trim();
      if (value === "0") continue;
      widths.add(value.split(/\s+/)[0]);
    }
    for (const match of section.matchAll(
      /border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-width:\s*([^;]+);/g,
    )) {
      widths.add(match[1].trim());
    }
    expect([...widths].sort()).toEqual(["1px"]);

    const radii = [
      ...section.matchAll(
        /border(?:-(?:(?:top|bottom)-(?:left|right)|(?:start|end)-(?:start|end)))?-radius:\s*([^;]+);/g,
      ),
    ].map((match) => match[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.every((radius) => radius === "0")).toBe(true);
  });

  it("keeps decorative green out and reserves the focus token for focus", () => {
    const section = stripComments(layer());
    expect(section).not.toMatch(/var\(--green(?:-ink|-wash)?\)|#16c47f/i);
    const focusUses = [...section.matchAll(/var\(--wk-focus\)/g)];
    expect(focusUses).toHaveLength(1);
    expect(section).toMatch(/:focus-visible\s*\{[^}]*outline: 2px solid var\(--wk-focus\)/);
  });

  it("renders quiet locked states with one upgrade fill and no specimen theatre", () => {
    const section = stripComments(layer());
    const start = section.indexOf(".f9-bl041-lock .f9-locked-feature");
    const end = section.indexOf(".f9-bl041-member-list", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const locked = section.slice(start, end);
    expect(locked).toContain("box-shadow: none;");
    expect(locked).toContain("background: transparent;");
    expect(locked).toMatch(
      /\.f9-bl041-lock \.f9-ed-cta--rank1 \{[^}]*background: var\(--wk-fill\)/,
    );
    expect(locked).not.toMatch(/dashed|f9-ed-specimen-slot/);
    expect(team).toContain('className="f9-bl041-lock"');
    expect(account).toContain('className="f9-bl041-entitlement"');
  });

  it("removes the Team action-gate tautology while preserving owner and member branches", () => {
    expect(team.match(/data\.plan !== "agency"/g)).toHaveLength(1);
    const agencyBranch = team.slice(team.indexOf('data.plan !== "agency"'));
    const inviteForm = agencyBranch.slice(
      agencyBranch.indexOf('className="f9-bl041-invite"'),
      agencyBranch.indexOf('className="f9-bl041-member-list"'),
    );
    expect(inviteForm).not.toContain('data.plan === "agency"');
    expect(agencyBranch).toContain("seatsUsed < data.seatLimit");
    expect(team).toContain("if (data.isMember)");
  });

  it("allows only the selected actionable billing plan to take the filled rank", () => {
    const planPicker = billing.slice(
      billing.indexOf("plans.map"),
      billing.indexOf("</article>", billing.indexOf("plans.map")),
    );
    expect(
      billing.match(/className=\{selected \? "f9-wk-btn" : "f9-bl041-text-action"\}/g),
    ).toHaveLength(2);
    expect(planPicker).not.toContain('className="f9-primary-button"');
    expect(layer()).toMatch(
      /\.f9-bl041-page :is\([\s\S]*?\.f9-primary-button,[\s\S]*?\)\s*\{[\s\S]*?background: transparent;/,
    );
    expect(layer()).toMatch(
      /\.f9-bl041-page a\.f9-wk-btn \{[^}]*color: var\(--wk-on-fill\)/,
    );
  });

  it("makes the danger zone quiet but unmistakable", () => {
    expect(account).toContain("f9-bl041-section f9-bl041-danger");
    expect(account).toContain('className="f9-bl041-danger-action"');
    const section = stripComments(layer());
    expect(section).toMatch(
      /\.f9-bl041-danger \{[^}]*border-top: 1px solid var\(--red\);[^}]*border-bottom-color: var\(--red\)/,
    );
    expect(section).toMatch(
      /\.f9-bl041-danger-action \{[^}]*border: 1px solid var\(--red\);[^}]*background: transparent/,
    );
  });
});
