import { describe, expect, it } from "vitest";

import { nightlyCatchUpInstance } from "../app/lib/brief-schedule";
import { holdDeadlinePassed, weekSendable } from "../app/lib/customer-ready";

const HOUR = 60 * 60 * 1000;
const CLOSE = new Date("2026-10-12T02:30:00.000Z");

describe("when a week's brief may go out", () => {
  it("goes out when every input has a verdict", () => {
    expect(weekSendable({ unjudgedInputs: 0, holdDeadlinePassed: false })).toBe(true);
  });

  it("is held while any input has no verdict", () => {
    expect(weekSendable({ unjudgedInputs: 1, holdDeadlinePassed: false })).toBe(false);
  });

  it("goes out anyway once the hold has run out, so one stuck input cannot silence a customer", () => {
    expect(weekSendable({ unjudgedInputs: 4, holdDeadlinePassed: true })).toBe(true);
  });

  it("runs out 72 hours after the week closes", () => {
    expect(holdDeadlinePassed(CLOSE, new Date(CLOSE.getTime() + 71 * HOUR))).toBe(false);
    expect(holdDeadlinePassed(CLOSE, new Date(CLOSE.getTime() + 72 * HOUR))).toBe(true);
  });
});

describe("the nightly catch-up", () => {
  it("gets a new Workflow id each night, so a held week is retried (Workflows ignore a reused id)", () => {
    const night1 = nightlyCatchUpInstance("ws_1", CLOSE, new Date("2026-10-13T03:00:00.000Z"));
    const night2 = nightlyCatchUpInstance("ws_1", CLOSE, new Date("2026-10-14T03:00:00.000Z"));
    expect(night1.id).not.toBe(night2.id);
    expect(nightlyCatchUpInstance("ws_1", CLOSE, new Date("2026-10-13T20:00:00.000Z")).id).toBe(night1.id);
  });
});
