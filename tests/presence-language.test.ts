import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ROUTE_PATH = "app/routes/app.presence.tsx";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function functionSpan(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("BL-034 Presence landing language", () => {
  it("keeps the current loader and action byte-frozen", () => {
    const source = read(ROUTE_PATH);
    expect(
      sha256(
        functionSpan(
          source,
          "export async function loader",
          "export async function action",
        ),
      ),
    ).toBe("ef29182bd7a1b4a0bae608cb61f6b5c5af2448e94c3b2948b5d3f1df403105b2");
    expect(
      sha256(
        functionSpan(
          source,
          "export async function action",
          "export default function PresenceIndexRoute",
        ),
      ),
    ).toBe("ed5711954140ad539f7f751ea96deae4e4f3a7b18c9cdcb6a7b95c04ba4afad8");
  });

  it("uses the shared workspace language without boxed Evidence Desk composition", () => {
    const source = read(ROUTE_PATH);
    for (const retired of [
      "DashboardPageHeader",
      "ActionFeedback",
      "EmptyState",
      "f9-app-panel",
      "f9-dashboard-grid",
      "f9-work-list",
      "f9-work-row",
      "f9-app-kicker",
      "f9-primary-button",
    ]) {
      expect(source).not.toContain(retired);
    }
    expect(source).toContain("WorkingHeader");
    expect(source).toContain("FeedbackStrip");
    expect(source).toContain("RuledList");
    expect(source).toContain("Source coverage");
    expect(source).toContain("Website and open-web");
    expect(source).not.toContain("whole-internet scanning");
  });

  it("keeps feedback atomic for assistive technology", () => {
    expect(read("app/components/workspace/feedback-strip.tsx")).toContain('aria-atomic="true"');
  });
});
