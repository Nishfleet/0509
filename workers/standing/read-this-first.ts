import { d4RequestBody, type D4Pack } from "../jev/context-pack";
import { quietWeekLine } from "../../app/lib/standing-present";

export interface D4Candidate {
  signalId: string;
  p: number;
  importance: number;
  reason: string | null;
  title: string | null;
  evidenceUrl: string | null;
}

export interface D4Verdict {
  p: number;
  importance: number;
  reason: string | null;
}

const STILL_READING = "still reading this week's items";

export function selectReadThisFirst(items: D4Candidate[]): D4Candidate[] {
  return items
    .filter((item) => item.p >= 0.5)
    .sort((a, b) => b.importance - a.importance || (a.signalId < b.signalId ? -1 : 1))
    .slice(0, 3);
}

export function whyLineFor(
  chosen: D4Candidate[],
  counts: { mentions: number; siteChanges: number; newAds: number },
  degraded: boolean,
  pending: boolean,
): { line: string; source: "jev" | "item" | "counts" | "degraded" | "pending" } {
  if (degraded) {
    return { line: "Sources are not answering.", source: "degraded" };
  }
  const top = chosen[0];
  if (top?.reason) return { line: top.reason, source: "jev" };
  if (top?.title) return { line: top.title, source: "item" };
  if (pending) return { line: STILL_READING, source: "pending" };
  return { line: quietWeekLine(counts.mentions, counts.siteChanges, counts.newAds), source: "counts" };
}

export async function postReadThisFirst(
  endpoint: string,
  token: string,
  pack: D4Pack,
  fetchImpl: typeof fetch = fetch,
): Promise<D4Verdict | null> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(d4RequestBody(pack)),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return parseVerdict(body);
}

export function parseVerdict(body: unknown): D4Verdict | null {
  if (!body || typeof body !== "object") return null;
  const answers = (body as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return null;
  const noul = (answers as { read_this_first?: unknown }).read_this_first;
  const score = (answers as { importance?: unknown }).importance;
  if (!noul || typeof noul !== "object" || !score || typeof score !== "object") return null;
  const noulRecord = noul as { noul?: unknown; probability?: unknown; reason?: unknown };
  const scoreRecord = score as { score?: unknown; reason?: unknown };
  const p = typeof noulRecord.noul === "number" ? noulRecord.noul : noulRecord.probability;
  const importance = scoreRecord.score;
  if (typeof p !== "number" || typeof importance !== "number") return null;
  const reason =
    typeof noulRecord.reason === "string"
      ? noulRecord.reason
      : typeof scoreRecord.reason === "string"
        ? scoreRecord.reason
        : null;
  return { p, importance, reason };
}
