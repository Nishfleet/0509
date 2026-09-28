import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import {
  MENTIONS_SWEEP_CRON,
  NIGHTLY_CRON,
  OWN_SITE_CHECK_CRON,
  SITE_SWEEP_CRON,
  SITE_SWEEP_UTC_LABEL,
  WEEKLY_REFRESH_CRON,
} from "../app/lib/cadence";
import { SITE_SWEEP_UTC_HOUR } from "../app/lib/onboarding/arrival-estimate";

// 0509#5823: the schedule constants live in app/lib/cadence.ts. The three
// Workflow schedules and the two trigger crons below are asserted against the
// constants, never against a literal, so the gate reddens the day one of them
// diverges from the constant it names.
describe("cadence", () => {
  it("schedules the site-sweep Workflow on SITE_SWEEP_CRON", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const siteSweep = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "site-sweep");
    expect(siteSweep).toBeDefined();
    expect(siteSweep?.schedules).toEqual([SITE_SWEEP_CRON]);
  });

  it("schedules the mentions-sweep Workflow on MENTIONS_SWEEP_CRON", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const mentionsSweep = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "mentions-sweep");
    expect(mentionsSweep).toBeDefined();
    expect(mentionsSweep?.schedules).toEqual([MENTIONS_SWEEP_CRON]);
  });

  it("schedules the own-site-check Workflow on OWN_SITE_CHECK_CRON", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const ownSiteCheck = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "own-site-check");
    expect(ownSiteCheck).toBeDefined();
    expect(ownSiteCheck?.schedules).toEqual([OWN_SITE_CHECK_CRON]);
  });

  it("triggers NIGHTLY_CRON and WEEKLY_REFRESH_CRON", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    expect(rawConfig.triggers?.crons).toContain(NIGHTLY_CRON);
    expect(rawConfig.triggers?.crons).toContain(WEEKLY_REFRESH_CRON);
  });

  it("derives the site-sweep cron and label from the UTC hour Home names", () => {
    expect(SITE_SWEEP_CRON).toBe(`0 ${SITE_SWEEP_UTC_HOUR} * * *`);
    expect(SITE_SWEEP_UTC_LABEL).toBe(`${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")}:00 UTC`);
  });
});
