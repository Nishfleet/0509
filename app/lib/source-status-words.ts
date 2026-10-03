import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "./mentions/channel-reasons";

const GENERIC = "not updating right now";

const WORDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    "no fresh data": "no new data yet",
    "not answering": "not answering right now",
    "timed out": "slow to answer",
    [LOST_CHANNEL_REASON]: "finding the channel again",
    [NO_CHANNEL_REASON]: "no YouTube channel on your profile",
  }).map(([key, words]) => [key.trim().toLowerCase(), words]),
);

export function plainSourceReason(reason: string | null): string {
  const key = (reason ?? "").trim().toLowerCase();
  if (key.startsWith("blocked:")) return WORDS["not answering"] ?? GENERIC;
  return WORDS[key] ?? GENERIC;
}
