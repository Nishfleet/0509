import { env } from "cloudflare:workers";

import { finishAccountDelete, readAccountFootprint } from "./account-delete.server";
import type { AccountFootprint } from "./account-delete.server";
import { oauthHelpers } from "./agent/oauth.server";
import { deleteUserWithApiKeys, readFixtureReapCandidates } from "./data/user.server";
import { readForeignChildSchedules } from "./data/workspace.server";
import { FIXTURE_ACCOUNTS, isPerRunFixtureEmail } from "./fixture-accounts";

export const FIXTURE_REAPER_CEILING = 25;

const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const KEPT_EMAILS = Object.values(FIXTURE_ACCOUNTS).map((account) => account.email);

export type ReaperMode = "live" | "dry-run";

export type ReaperStep = <T extends Rpc.Serializable<T>>(name: string, work: () => Promise<T>) => Promise<T>;

interface ReaperSelection {
  userIds: string[];
  ceilingHit: boolean;
}

export interface ReaperReport {
  mode: ReaperMode;
  selected: number;
  workspaces: number;
  entities: number;
  prefixes: number;
  deleted: number;
  ceilingHit: boolean;
}

export function reaperMode(raw: unknown): ReaperMode {
  return raw === "live" ? "live" : "dry-run";
}

async function selectFixtureUsers(now: Date): Promise<ReaperSelection> {
  const rows = await readFixtureReapCandidates(
    new Date(now.getTime() - MIN_AGE_MS).toISOString(),
    KEPT_EMAILS,
    FIXTURE_REAPER_CEILING,
  );
  return {
    userIds: rows.filter((row) => isPerRunFixtureEmail(row.email)).map((row) => row.id),
    ceilingHit: rows.length >= FIXTURE_REAPER_CEILING,
  };
}

async function reapUser(mode: ReaperMode, user: { userId: string; label: string }, step: ReaperStep) {
  const { userId, label } = user;
  const footprint = await step(`footprint ${label}`, async () =>
    readAccountFootprint(userId, await readForeignChildSchedules(userId)),
  );
  if (mode === "dry-run") return { footprint, deleted: 0 };
  await step(`purge ${label}`, () =>
    finishAccountDelete(oauthHelpers(env), { userId, footprint, instanceId: `fixture-reaper-${userId}` }),
  );
  const deleted = await step(`remove ${label}`, () => deleteUserWithApiKeys(userId));
  return { footprint, deleted };
}

function tally(
  mode: ReaperMode,
  selection: ReaperSelection,
  reaped: { footprint: AccountFootprint; deleted: number }[],
): ReaperReport {
  const sum = (count: (footprint: AccountFootprint) => number) =>
    reaped.reduce((total, entry) => total + count(entry.footprint), 0);
  return {
    mode,
    selected: selection.userIds.length,
    workspaces: sum((footprint) => footprint.owned.length),
    entities: sum((footprint) => footprint.entityIds.length),
    prefixes: sum((footprint) => footprint.prefixes.length),
    deleted: reaped.reduce((total, entry) => total + entry.deleted, 0),
    ceilingHit: selection.ceilingHit,
  };
}

export async function reapFixtureAccounts(rawMode: unknown, now: Date, step: ReaperStep): Promise<ReaperReport> {
  const mode = reaperMode(rawMode);
  const selection = await step("select", () => selectFixtureUsers(now));
  const reaped = [];
  for (const [index, userId] of selection.userIds.entries()) {
    reaped.push(await reapUser(mode, { userId, label: String(index) }, step));
  }
  const report = tally(mode, selection, reaped);
  await step("report", () => {
    console.log(JSON.stringify({ event: "fixture_reaper.run", ...report }));
    return Promise.resolve(report);
  });
  return report;
}

export async function startFixtureReaper(now: Date): Promise<string> {
  const id = `fixture-reaper-${now.toISOString().slice(0, 10)}`;
  await env.FIXTURE_REAPER_WORKFLOW.createBatch([{ id }]);
  return id;
}
