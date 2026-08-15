import type { FactRow } from "~/components/evidence/fact-rail";
import type { ReactNode } from "react";
import { countryNameFromIso } from "~/lib/countries";
import type {
  WatchlistProofSummary,
  WatchlistRunRecord,
  WatchlistTrackingRole,
} from "~/lib/types";
import { formatWatchBandCadence } from "~/lib/watchlist-display";
import { formatWatchlistTrackingRole } from "~/lib/watchlist-role";

/**
 * Competitor detail presentation — brief §6.3 (status strip), §6.6 (fact
 * rail and honest inline values), §7 (detail composition).
 *
 * Pure and framework-free so every honest-degrade path (no country, no
 * capture, no completed check) is unit-testable without a DOM.
 */

/**
 * Provider cooldowns are soft failures: the watchlist is fine, the provider
 * asked us to wait. They never count towards "tracking is broken" — on the
 * board (SQL) or here.
 */
export const SOFT_RUN_FAILURE_CODES: ReadonlySet<string> = new Set([
  "rate_limited",
  "cache_only",
]);

/**
 * Hard failures since the last successful check.
 *
 * BL-006 landed the board's definition in SQL
 * (`watchlist-board.server.ts`): every hard-failed run started AFTER the
 * newest succeeded run. The opened competitor's banner used a different
 * definition — it walked the run list and stopped at the first run that was
 * not `failed` — so a single `pending` or `skipped` row between two failures
 * reset the detail count to zero while the board still stamped "Needs
 * attention". Same watchlist, same page, two numbers.
 *
 * This is the board's definition, expressed over an ordered run list, and it
 * is now the only one either surface uses.
 */
export function countHardFailuresSinceLastSuccess(
  runs: readonly Pick<WatchlistRunRecord, "status" | "errorCode">[],
): number {
  let failures = 0;
  for (const run of runs) {
    // Newest-first: the first success closes the window.
    if (run.status === "succeeded") break;
    if (run.status !== "failed") continue;
    if (SOFT_RUN_FAILURE_CODES.has(run.errorCode ?? "")) continue;
    failures += 1;
  }
  return failures;
}

/** The number card's value: confirmed changes stored inside the window. */
export function formatCaughtNumber(capturedChanges: number): string {
  return String(Math.max(0, Math.trunc(capturedChanges)));
}

/**
 * The note under the number, in product voice. Quiet is a finding, not a gap
 * (§6.2, DESIGN.md voice rule 5) — so it never reads as an apology.
 */
export function formatCaughtNote(input: {
  capturedChanges: number;
  windowDays: number;
  lastScannedAt: string | null;
  isActive: boolean;
}): string {
  if (!input.isActive) {
    return "Paused — no checks run, and the history stays.";
  }
  if (input.capturedChanges > 0) {
    return input.capturedChanges === 1
      ? `One change captured in the last ${input.windowDays} days.`
      : `${input.capturedChanges} changes captured in the last ${input.windowDays} days.`;
  }
  if (!input.lastScannedAt) {
    return "No completed check yet — the first capture is still running.";
  }
  return `Checked, and nothing has changed in ${input.windowDays} days. That is the finding.`;
}

/** Watch age in whole days, from the day tracking started. */
export function formatWatchAge(createdAt: string | null, now: Date): string | null {
  if (!createdAt) return null;
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return null;
  const days = Math.max(0, Math.floor((now.getTime() - started) / 86_400_000));
  if (days === 0) return "Added today";
  return days === 1 ? "Watching 1 day" : `Watching ${days} days`;
}

/** Relative freshness for the fact rail; callers may re-render it as time moves. */
export function formatLastCheck(lastScannedAt: string | null, now: Date): string | null {
  if (!lastScannedAt) return null;
  const checkedAt = Date.parse(lastScannedAt);
  if (Number.isNaN(checkedAt)) return null;
  const elapsedMs = Math.max(0, now.getTime() - checkedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatWatchMarket(targetCountry: string | null | undefined): string | null {
  const raw = targetCountry?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "all") return "Every market";
  return countryNameFromIso(raw) ?? raw;
}

/** Evidence-check tally for the rail — counts only, never a claim. */
export function formatEvidenceAttempts(summary: WatchlistProofSummary): string | null {
  if (summary.totalAttempts === 0) return null;
  const parts = [`${summary.successfulAttempts} good`];
  if (summary.failedAttempts > 0) parts.push(`${summary.failedAttempts} failed`);
  if (summary.skippedAttempts > 0) parts.push(`${summary.skippedAttempts} skipped`);
  return parts.join(" · ");
}

/**
 * The fact rail — edited to what an agency would quote, not everything the
 * loader returns (§6.6). Eight rows is the hard ceiling and this rail sits
 * at it; adding a ninth means removing one.
 *
 * BL-035 removed the status strip, so Last check lives in this shared rail
 * across every URL tab and stays the freshness anchor when the detail is
 * deep-linked. Next check remains Setup work and source health stays in the
 * working header.
 */
export function buildCompetitorFactRows(input: {
  targetLabel: string;
  targetCountry: string | null;
  trackingRole: WatchlistTrackingRole | null;
  isActive: boolean;
  plan: string;
  createdAt: string | null;
  lastScannedAt: string | null;
  /** Optional live value so the UI can re-render relative freshness. */
  lastCheckValue?: ReactNode;
  now: Date;
  proofSummary: WatchlistProofSummary;
  storedChanges: number;
}): FactRow[] {
  return [
    {
      key: "Tracked as",
      value: formatWatchlistTrackingRole(input.trackingRole),
    },
    { key: "Target", value: input.targetLabel },
    {
      key: "Market",
      value: formatWatchMarket(input.targetCountry),
      missingLabel: "not set — scanned as first saved",
    },
    {
      key: "Cadence",
      value: formatWatchBandCadence({ isActive: input.isActive, plan: input.plan }),
    },
    {
      key: "Last check",
      value: input.lastCheckValue ?? formatLastCheck(input.lastScannedAt, input.now),
      missingLabel: "none yet",
    },
    {
      key: "Watch age",
      value: formatWatchAge(input.createdAt, input.now),
      missingLabel: "not recorded",
    },
    {
      key: "Proof captures",
      value: formatEvidenceAttempts(input.proofSummary),
      missingLabel: "none yet",
    },
    {
      key: "Changes on file",
      value: input.storedChanges > 0 ? String(input.storedChanges) : null,
      missingLabel: "none yet",
    },
  ];
}

export interface CompetitorDeliveryLine {
  key: string;
  value: string;
}

/**
 * The rail's delivery card: who gets told, in words, read-only. The controls
 * themselves live on the Delivery tab — this card is the answer, not the
 * form (§7 "right rail: 1 number card, 1 fact rail, 1 delivery card").
 */
export function buildCompetitorDeliveryLines(input: {
  emailEnabled: boolean;
  canEmailDelivery: boolean;
  instantEnabled: boolean;
  digestEnabled: boolean;
  quietHours: { startHour: number; endHour: number } | null;
  timezone: string | null;
  targetCount: number;
  canManageDelivery: boolean;
}): CompetitorDeliveryLine[] {
  const lines: CompetitorDeliveryLine[] = [
    {
      key: "Email",
      // The rail must tell the same truth as the Delivery tab: a stored
      // email target does not mean email is going out when the plan has no
      // email delivery entitlement.
      value: !input.canEmailDelivery
        ? "Off — requires Scout"
        : input.emailEnabled
          ? "On"
          : "Off",
    },
    {
      key: "Instant alerts",
      value: input.instantEnabled ? "On — sent when a scan confirms a major change" : "Off",
    },
    {
      key: "Digest",
      value: input.digestEnabled ? "On" : "Off",
    },
  ];

  if (input.quietHours) {
    lines.push({
      key: "Quiet hours",
      value: `${formatHour(input.quietHours.startHour)}–${formatHour(input.quietHours.endHour)}${
        input.timezone ? ` ${input.timezone}` : " UTC"
      }`,
    });
  }

  lines.push({
    key: "Recipients",
    value: !input.canManageDelivery
      ? "Managed by the workspace owner"
      : input.targetCount === 0
        ? "Workspace default address"
        : input.targetCount === 1
          ? "1 address for this competitor"
          : `${input.targetCount} addresses for this competitor`,
  });

  return lines;
}

function formatHour(hour: number): string {
  const bounded = Math.min(23, Math.max(0, Math.trunc(hour)));
  return `${String(bounded).padStart(2, "0")}:00`;
}
