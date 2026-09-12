import { describe, expect, it } from "vitest";

import { reportError, summarizeErrorReports } from "~/lib/error-report.server";

import { appEnv, uid } from "./fixtures";

/**
 * Issue #2988 — the error_report sink against real D1 (migrations 0096
 * applied). This is the read AND write path proof the migration rule asks
 * for: rows written by the sink must come back unchanged through the same
 * summary queries the hourly judges read.
 */

let sequence = 0;
function testRoute(prefix: string) {
  sequence += 1;
  return `/${prefix}/test-${sequence}`;
}

describe("error_report sink (migration 0096)", () => {
  it("a thrown error reports exactly one row with route, reason code and a stack sample", async () => {
    const route = testRoute("sink");
    const reasonCode = `rc_${uid("r").slice(8)}`;
    const error = new Error("integration loader exploded");
    const result = await reportError(appEnv, { route, reasonCode, error });
    expect(result).toEqual({ written: true, reason: "written" });

    const rows = await appEnv.DB!.prepare(
      "SELECT route, reason_code, message, stack_sample FROM error_report WHERE route = ?",
    ).bind(route).all<{ route: string; reason_code: string; message: string; stack_sample: string | null }>();
    expect(rows.results?.length).toBe(1);
    const row = rows.results![0];
    expect(row.reason_code).toBe(reasonCode);
    expect(row.message).toContain("integration loader exploded");
    // Stack sample: header line dropped, frames present (line count <= 3).
    expect(row.stack_sample).toBeTruthy();
    expect(row.stack_sample!.split("\n").length).toBeLessThanOrEqual(3);
    expect(row.stack_sample).not.toContain("Error: integration loader exploded");
  });

  it("summarizeErrorReports returns the row on the judge dashboard query", async () => {
    const reasonCode = `judge_${uid("j").slice(8)}`;
    const route = testRoute("judge");
    await reportError(appEnv, { route, reasonCode, error: new Error("judge count check") });

    const summary = await summarizeErrorReports(appEnv);
    expect(summary.counts).not.toBeNull();
    expect(summary.recent).not.toBeNull();
    const match = summary.counts!.find((c) => c.reason_code === reasonCode && c.route === route);
    expect(match?.count).toBe(1);
    expect(summary.recent!.some((row) => row.reason_code === reasonCode)).toBe(true);
  });

  it("unsafe reason codes fall back to unknown_reason", async () => {
    const route = testRoute("sanitise");
    await reportError(appEnv, { route, reasonCode: "bad code; DROP TABLE user--; ", error: new Error("x") });
    const rows = await appEnv.DB!.prepare(
      "SELECT reason_code FROM error_report WHERE route = ?",
    ).bind(route).all<{ reason_code: string }>();
    expect(rows.results?.[0]?.reason_code).toBe("unknown_reason");
  });
});
