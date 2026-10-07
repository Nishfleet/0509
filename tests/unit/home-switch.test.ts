import { describe, expect, it } from "vitest";

import { rowSwitchView } from "../../app/lib/home-switch";

function form(intent: string): FormData {
  const data = new FormData();
  data.set("intent", intent);
  return data;
}

describe("rowSwitchView", () => {
  it("shows OFF with a pending note while a turn-off is in flight", () => {
    const view = rowSwitchView({ self: false, name: "Kindred", formData: form("off"), message: null });
    expect(view).toEqual({ state: "off", pendingNote: "Turning off Kindred…", errorNote: null });
  });

  it("shows ON with a pending note while a turn-on is in flight", () => {
    const view = rowSwitchView({ self: false, name: "Kindred", formData: form("on"), message: null });
    expect(view).toEqual({ state: "on", pendingNote: "Turning on Kindred…", errorNote: null });
  });

  it("reports the action's refusal once idle", () => {
    const view = rowSwitchView({ self: false, name: "Kindred", formData: undefined, message: "Plan is full." });
    expect(view).toEqual({ state: "on", pendingNote: null, errorNote: "Plan is full." });
  });

  it("keeps the own brand on YOU", () => {
    const view = rowSwitchView({ self: true, name: "Own", formData: undefined, message: null });
    expect(view.state).toBe("you");
  });
});
