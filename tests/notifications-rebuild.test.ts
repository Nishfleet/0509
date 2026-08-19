import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync("app/routes/app.notifications.ts", "utf8");
const ui = readFileSync("app/routes/app.notifications.ui.tsx", "utf8");
const css = readFileSync("app/app.css", "utf8");
const MARKER = "/* === BL-039 notifications (landing language) === */";
const FROZEN_ROUTE_SHA256 =
  "bf6943d14a1aaa2f32ed2048873e8addf7a1fa20543d72152c14bafa162194e3";

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

// The owned layer runs from the BL-039 marker to the next lane's section
// marker (BL-040 landed after this branch was cut) or to the end of the file.
// Bounding it here keeps these assertions about BL-039's own CSS instead of
// silently grading whichever landing-language lane merged last.
function ownedLayer() {
  const markerIndex = css.indexOf(MARKER);
  if (markerIndex < 0) return null;
  const rest = css.slice(markerIndex + MARKER.length);
  const nextSection = rest.search(/\/\* === BL-\d+ /u);
  const end =
    nextSection < 0 ? css.length : markerIndex + MARKER.length + nextSection;
  return {
    markerIndex,
    layer: stripComments(css.slice(markerIndex, end)),
  };
}

describe("BL-039 notifications rebuild", () => {
  it("keeps the loader/action surface live after webhook delivery reactivation", () => {
    // The BL-039 byte-freeze served the reskin era; the design-unification
    // subtraction pass (S1) deliberately edited this module, and the 2026-08-12
    // Slack/Teams webhook-delivery decision re-added the live handlers. What
    // must hold now: WhatsApp stays dormant (honest unavailable answer only),
    // and the loader exposes exactly the live delivery surface.
    expect(route).toContain("save-slack-webhook");
    expect(route).toContain("save-teams-webhook");
    expect(route).toContain("saveSlackWebhookTarget");
    expect(route).toContain("saveTeamsWebhookTarget");
    expect(route).toContain("listDeliveryTargets");
    expect(route).toContain("save-digest-cadence");
    // WhatsApp remains a dormant GA channel: only the honest unavailable
    // answer may exist, never a live handler.
    expect(route).not.toContain("saveWhatsAppDeliveryTarget");
    expect(route).toContain("whatsappDeliveryUnavailableMessage");
  });

  it("uses the shared working header and removes the old card dashboard", () => {
    expect(ui).toContain(
      '<DashboardPage className="f9-wk-page f9-notif-page">',
    );
    expect(ui).toContain("<WorkingHeader");
    expect(ui).toContain('title="Delivery channel"');
    expect(ui).not.toContain("DashboardPageHeader");
    expect(ui).not.toContain("f9-wk-panel");
    expect(ui).not.toContain("f9-status-strip");
    expect(ui).not.toContain("f9-dashboard-grid");
  });

  it("adds exactly one owned CSS section after the BL-030 layer", () => {
    expect(css.match(/BL-039 notifications \(landing language\)/g)).toHaveLength(
      1,
    );
    const owned = ownedLayer();
    expect(owned).not.toBeNull();
    const { markerIndex, layer } = owned!;
    expect(layer.length).toBeGreaterThan(1_000);
    expect(markerIndex).toBeGreaterThan(css.indexOf("BL-030"));

    const widths = new Set<string>();
    for (const match of layer.matchAll(
      /border(?:-top|-right|-bottom|-left)?:\s*([^;]+);/g,
    )) {
      const value = match[1].trim();
      if (value === "0") continue;
      widths.add(value.split(/\s+/)[0]);
    }
    for (const match of layer.matchAll(
      /border-(?:top|right|bottom|left)-width:\s*([^;]+);/g,
    )) {
      widths.add(match[1].trim());
    }
    expect([...widths].sort()).toEqual(["1px"]);
  });

  it("keeps the owned layer square, flat, and token-based", () => {
    const owned = ownedLayer();
    expect(owned).not.toBeNull();
    const { layer } = owned!;
    const radii = [...layer.matchAll(/border-radius:\s*([^;]+);/g)].map(
      (match) => match[1].trim(),
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii).toEqual(radii.map(() => "0"));
    expect(layer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(layer).not.toMatch(/linear-gradient|radial-gradient/);
    expect(layer).not.toMatch(/box-shadow\s*:/);
    expect(layer).not.toMatch(/border-style:\s*dashed/);
  });
});
