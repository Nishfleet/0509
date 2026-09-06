import type {
  ProofSkipReason,
  ProofStatus,
  SensitivityMode,
  WatchEventType,
} from "~/lib/types";

export const V1_PROOF_THRESHOLDS: Record<SensitivityMode, number> = {
  quiet: 85,
  balanced: 70,
  aggressive: 60,
  auto: 70,
};

export const V1_PROOF_BUDGETS = {
  perWatchlistRun: 3,
  perWatchlistDay: 12,
  perWorkspaceDay: 60,
  circuitBreakerWindow: 20,
  circuitBreakerFailureRate: 0.5,
  workspaceConcurrencyCap: 2,
  freshnessWindowMs: 7 * 24 * 60 * 60 * 1000,
  proofDedupeWindowMs: 6 * 60 * 60 * 1000,
  targetFailureCooldownMs: 6 * 60 * 60 * 1000,
} as const;

export type ProofPolicyBucket =
  | "event-triggered"
  | "freshness-triggered"
  | "priority-triggered";

export interface ProofPolicyInput {
  sensitivityMode: SensitivityMode;
  triggerEventTypes: WatchEventType[];
  lastSuccessfulProofAt: string | null;
  watchlistRunAttemptCount: number;
  watchlistDailyAttemptCount: number;
  workspaceDailyAttemptCount: number;
  workspaceMonthlyAttemptCount?: number;
  workspaceMonthlyCap?: number;
  /** Subscription-period remaining checks (included + spendable top-up). */
  workspaceEvidenceRemaining?: number;
  // Per-plan daily ceiling (credits included); falls back to the flat v1
  // budget. A flat 60/day made the agency tier's 2,500 monthly checks and
  // every purchased credit pack mathematically unreachable.
  workspaceDailyCap?: number;
  workspaceRecentAttempts: Array<Pick<{ status: ProofStatus }, "status">>;
  activeCaptureCount: number;
  burstCount: number;
  proofRequestDuplicate: boolean;
  recentFailureCountForTarget: number;
  /**
   * V1 fairness caps: 3 captures per watchlist run, 12 per watchlist day.
   * Paid plans pass false (#958) so those caps cannot starve a plan that
   * still has remaining checks. Workspace daily/monthly remaining still
   * apply. Default true (free / unspecified).
   */
  applyPerWatchlistBudgets?: boolean;
  now?: string;
}

export interface ProofPolicyDecision {
  threshold: number;
  score: number;
  bucket: ProofPolicyBucket | null;
  forced: boolean;
  shouldCapture: boolean;
  skipReason: ProofSkipReason | null;
}

export function buildCanonicalPageIdentity(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const normalizedPath = normalizePath(parsed.pathname);
    const searchParams = [...parsed.searchParams.entries()]
      .filter(([key]) => !isTrackingParam(key))
      .sort(([left], [right]) => left.localeCompare(right));
    const normalizedQuery = new URLSearchParams(searchParams).toString();

    return `${normalizeHost(parsed)}${normalizedPath}${normalizedQuery ? `?${normalizedQuery}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function buildProofTargetIdentity(input: {
  watchlistId: string;
  adId: string | null;
  canonicalPageIdentity: string;
}) {
  return [input.watchlistId, input.adId ?? "none", input.canonicalPageIdentity].join(":");
}

export function resolveProofThreshold(sensitivityMode: SensitivityMode) {
  return V1_PROOF_THRESHOLDS[sensitivityMode];
}

export function isProofFresh(lastSuccessfulProofAt: string | null, now = new Date().toISOString()) {
  if (!lastSuccessfulProofAt) {
    return false;
  }

  return (
    new Date(now).getTime() - new Date(lastSuccessfulProofAt).getTime() <
    V1_PROOF_BUDGETS.freshnessWindowMs
  );
}

export function countRecentProofFailures(
  captures: Array<Pick<{ status: ProofStatus; attemptedAt: string }, "status" | "attemptedAt">>,
  now = new Date().toISOString(),
) {
  const nowMs = new Date(now).getTime();
  return captures.filter((capture) => {
    if (capture.status !== "failed") return false;
    const attemptedAtMs = new Date(capture.attemptedAt).getTime();
    return (
      Number.isFinite(attemptedAtMs) &&
      nowMs - attemptedAtMs >= 0 &&
      nowMs - attemptedAtMs < V1_PROOF_BUDGETS.targetFailureCooldownMs
    );
  }).length;
}

export function evaluateProofPolicy(input: ProofPolicyInput): ProofPolicyDecision {
  const threshold = resolveProofThreshold(input.sensitivityMode);
  const fresh = isProofFresh(input.lastSuccessfulProofAt, input.now);
  const score = computeCandidateScore(input, fresh);
  const forced =
    input.triggerEventTypes.includes("landing_page_url_changed") ||
    (!input.lastSuccessfulProofAt && input.sensitivityMode !== "quiet");
  const bucket = resolveBucket(input, fresh, score, threshold);

  if (!bucket) {
    return {
      threshold,
      score,
      bucket: null,
      forced,
      shouldCapture: false,
      skipReason: null,
    };
  }

  if (input.proofRequestDuplicate) {
    return buildSkippedDecision(threshold, score, bucket, forced, "skipped_due_to_dedupe");
  }

  if (
    typeof input.workspaceEvidenceRemaining === "number" &&
    input.workspaceEvidenceRemaining <= 0
  ) {
    return buildSkippedDecision(threshold, score, bucket, forced, "skipped_due_to_budget");
  }

  if (hasExhaustedMonthlyCap(input.workspaceMonthlyAttemptCount, input.workspaceMonthlyCap)) {
    return buildSkippedDecision(threshold, score, bucket, forced, "skipped_due_to_budget");
  }

  if (input.activeCaptureCount >= V1_PROOF_BUDGETS.workspaceConcurrencyCap) {
    return buildSkippedDecision(threshold, score, bucket, forced, "skipped_due_to_rate_limit");
  }

  if (input.recentFailureCountForTarget >= 2) {
    return buildSkippedDecision(threshold, score, bucket, forced, "skipped_due_to_rate_limit");
  }

  if (!forced) {
    const circuitBreakerOpen = isCircuitBreakerOpen(input.workspaceRecentAttempts);
    if (circuitBreakerOpen) {
      return buildSkippedDecision(threshold, score, bucket, false, "skipped_due_to_rate_limit");
    }

    const honorPerWatchlistBudgets = input.applyPerWatchlistBudgets !== false;
    if (
      (honorPerWatchlistBudgets &&
        (input.watchlistRunAttemptCount >= V1_PROOF_BUDGETS.perWatchlistRun ||
          input.watchlistDailyAttemptCount >= V1_PROOF_BUDGETS.perWatchlistDay)) ||
      input.workspaceDailyAttemptCount >=
        (input.workspaceDailyCap ?? V1_PROOF_BUDGETS.perWorkspaceDay)
    ) {
      return buildSkippedDecision(threshold, score, bucket, false, "skipped_due_to_budget");
    }
  }

  return {
    threshold,
    score,
    bucket,
    forced,
    shouldCapture: true,
    skipReason: null,
  };
}

function hasExhaustedMonthlyCap(count: number | undefined, cap: number | undefined) {
  if (typeof count !== "number" || typeof cap !== "number" || !Number.isFinite(cap)) {
    return false;
  }

  return cap >= 0 && count >= cap;
}

function computeCandidateScore(input: ProofPolicyInput, fresh: boolean) {
  let score = 0;

  if (input.triggerEventTypes.includes("landing_page_url_changed")) {
    score += 60;
  }
  if (!input.lastSuccessfulProofAt) {
    score += 35;
  }
  if (input.burstCount >= 3) {
    score += 25;
  }
  if (!fresh) {
    score += 20;
  }
  if (input.sensitivityMode === "aggressive") {
    score += 10;
  }
  if (input.recentFailureCountForTarget >= 2) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

function resolveBucket(
  input: ProofPolicyInput,
  fresh: boolean,
  score: number,
  threshold: number,
): ProofPolicyBucket | null {
  if (
    input.triggerEventTypes.includes("landing_page_url_changed") ||
    (!input.lastSuccessfulProofAt && input.sensitivityMode !== "quiet")
  ) {
    return "event-triggered";
  }

  if (!fresh && input.sensitivityMode !== "quiet") {
    return "freshness-triggered";
  }

  if (score >= threshold) {
    return "priority-triggered";
  }

  return null;
}

function buildSkippedDecision(
  threshold: number,
  score: number,
  bucket: ProofPolicyBucket,
  forced: boolean,
  skipReason: ProofSkipReason,
): ProofPolicyDecision {
  return {
    threshold,
    score,
    bucket,
    forced,
    shouldCapture: false,
    skipReason,
  };
}

function isCircuitBreakerOpen(attempts: Array<Pick<{ status: ProofStatus }, "status">>) {
  if (attempts.length < V1_PROOF_BUDGETS.circuitBreakerWindow) {
    return false;
  }

  const recent = attempts.slice(0, V1_PROOF_BUDGETS.circuitBreakerWindow);
  const failedCount = recent.filter((attempt) => attempt.status === "failed").length;
  return failedCount / recent.length >= V1_PROOF_BUDGETS.circuitBreakerFailureRate;
}

function isTrackingParam(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.startsWith("utm_") ||
    normalized === "fbclid" ||
    normalized === "gclid" ||
    normalized === "mc_cid" ||
    normalized === "mc_eid"
  );
}

function normalizeHost(url: URL) {
  const hostname = url.hostname.toLowerCase();
  const defaultPort =
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80");
  const port = url.port && !defaultPort ? `:${url.port}` : "";
  return `${hostname}${port}`;
}

function normalizePath(pathname: string) {
  const normalized = pathname.replace(/\/{2,}/g, "/").trim() || "/";
  if (normalized === "/") {
    return normalized;
  }

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
