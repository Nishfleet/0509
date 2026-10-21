import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "./mentions/channel-reasons";
import { sourcePillStatus, type SourceRow, type SourceSnapshot } from "./source-pill-status";

const GENERIC = "not updating right now";
const NO_DATA_YET = "no new data yet";

const WORDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    "no fresh data": NO_DATA_YET,
    "not answering": "could not be checked right now",
    "timed out": "slow to answer",
    [LOST_CHANNEL_REASON]: "finding the channel again",
    [NO_CHANNEL_REASON]: "no YouTube channel found",
  }).map(([key, words]) => [key.trim().toLowerCase(), words]),
);

export function plainSourceReason(reason: string | null): string {
  const key = (reason ?? "").trim().toLowerCase();
  if (key.startsWith("blocked:")) return WORDS["not answering"] ?? GENERIC;
  return WORDS[key] ?? GENERIC;
}

export function withoutNoDataYet<T extends { source: SourceRow; snapshot: SourceSnapshot | null }>(
  entries: readonly T[],
  now: number,
): T[] {
  return entries.filter((entry) => {
    const status = sourcePillStatus(entry.source, entry.snapshot, now);
    return status.state !== "degraded" || plainSourceReason(status.reason) !== NO_DATA_YET;
  });
}
