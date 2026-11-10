import { env } from "cloudflare:workers";

import { readLatestStandingWeek } from "./data/standing.server";
import { landingWorkspaceId } from "./env.server";
import { type LandingSample, isStaleLandingSample } from "./landing-sample";

const CARD_PREFIX = "card/";
const CARD_OBJECT = "index.html";

const reportedWeeks = new Set<string>();

interface SampleReport {
  readonly event: "landing.sample_stale" | "landing.sample_unavailable";
  readonly workspaceId: string;
  readonly weekStartAt: string;
  readonly error?: string;
}

function reportOnce(report: SampleReport): void {
  const { event, workspaceId, weekStartAt: week, error } = report;
  if (reportedWeeks.has(week)) return;
  reportedWeeks.add(week);
  console.warn(
    JSON.stringify(error === undefined ? { event, workspaceId, week } : { event, workspaceId, week, error }),
  );
}

function cardKey(workspaceId: string, weekStartAt: string): string {
  return `${CARD_PREFIX}${workspaceId}/${weekStartAt}/${CARD_OBJECT}`;
}

async function readCard(key: string): Promise<string | null> {
  const object = await env.SNAPSHOTS.get(key);
  return object === null ? null : object.text();
}

export async function readLandingSample(now: number): Promise<LandingSample | null> {
  const workspaceId = landingWorkspaceId();
  if (workspaceId === null) return null;
  const weekStartAt = await readLatestStandingWeek(env.DB, workspaceId);
  if (weekStartAt === null) return null;
  if (isStaleLandingSample(weekStartAt, now)) {
    reportOnce({ event: "landing.sample_stale", workspaceId, weekStartAt });
    return null;
  }
  let html: string | null;
  try {
    html = await readCard(cardKey(workspaceId, weekStartAt));
  } catch (error) {
    reportOnce({
      event: "landing.sample_unavailable",
      workspaceId,
      weekStartAt,
      error: String(error).slice(0, 300),
    });
    return null;
  }
  if (html === null) {
    reportOnce({ event: "landing.sample_unavailable", workspaceId, weekStartAt });
    return null;
  }
  return { weekStartAt, html };
}
