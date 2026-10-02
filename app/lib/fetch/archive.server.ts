import { z } from "zod";

import { cappedJson, cappedText, fetchOutbound } from "./outbound.server";
import { CRAWLER_USER_AGENT } from "./robots.server";
import { refusalReason, type ReadUrlResult } from "./transport.server";

const ARCHIVE_MAX_AGE_MS = 3 * 86_400_000;

const AVAILABILITY_URL = "https://archive.org/wayback/available";
const MAX_BYTES = 5_000_000;
const HEADERS = { "user-agent": CRAWLER_USER_AGENT, accept: "text/html,application/xhtml+xml" } as const;

const availability = z.object({
  archived_snapshots: z.object({
    closest: z
      .object({
        available: z.boolean(),
        status: z.string(),
        timestamp: z.string().regex(/^\d{14}$/),
      })
      .optional(),
  }),
});

export function waybackStamp(date: Date): string {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

function stampTime(stamp: string): number {
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
  return Date.parse(iso);
}

async function freshStamp(url: string, now: Date): Promise<string | null> {
  const query = new URLSearchParams({ url, timestamp: waybackStamp(now) });
  const res = await fetchOutbound(`${AVAILABILITY_URL}?${query.toString()}`, {
    headers: HEADERS,
    schemes: ["https:"],
  });
  if (!res.ok) return null;
  const parsed = availability.safeParse(await cappedJson(res, MAX_BYTES));
  const closest = parsed.success ? parsed.data.archived_snapshots.closest : undefined;
  if (closest?.available !== true || closest.status !== "200") return null;
  const age = now.getTime() - stampTime(closest.timestamp);
  return Number.isNaN(age) || age < 0 || age > ARCHIVE_MAX_AGE_MS ? null : closest.timestamp;
}

export async function readArchiveCopy(url: string, now: Date): Promise<ReadUrlResult | null> {
  const started = Date.now();
  try {
    const stamp = await freshStamp(url, now);
    if (stamp === null) return null;
    const res = await fetchOutbound(`https://web.archive.org/web/${stamp}id_/${url}`, {
      headers: HEADERS,
      schemes: ["https:"],
    });
    if (!res.ok) return null;
    const html = await cappedText(res, MAX_BYTES);
    if (html === null || (await refusalReason(200, html)) !== null) return null;
    return {
      ok: true,
      html,
      transport: "fetch",
      status: 200,
      ms: Date.now() - started,
      escalated: false,
      fromArchive: true,
    };
  } catch (error) {
    console.log(
      JSON.stringify({ event: "archive.read_failed", error: error instanceof Error ? error.name : "unknown" }),
    );
    return null;
  }
}

export async function readOrArchive(
  read: ReadUrlResult,
  archive: { url: string; now: Date; allowed: boolean },
): Promise<ReadUrlResult> {
  if (read.ok || !archive.allowed || read.reason !== "escalation-failed") return read;
  return (await readArchiveCopy(archive.url, archive.now)) ?? read;
}
