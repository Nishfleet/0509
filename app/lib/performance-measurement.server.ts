/**
 * Pure, fail-closed performance evidence evaluators.
 *
 * This module deliberately does not collect telemetry or choose route-specific
 * budgets. Callers provide finite measurements, and these helpers only return
 * bounded derived values and safe failure codes.
 */

export const CORE_WEB_VITAL_BUDGETS = Object.freeze({
  lcpMs: 2_500,
  inpMs: 200,
  cls: 0.1,
});

export type CoreWebVitalFailure =
  | "lcp_missing"
  | "lcp_invalid"
  | "lcp_budget_exceeded"
  | "inp_missing"
  | "inp_invalid"
  | "inp_budget_exceeded"
  | "cls_missing"
  | "cls_invalid"
  | "cls_budget_exceeded";

export interface CoreWebVitalsEvaluation {
  ok: boolean;
  status: "pass" | "fail";
  failures: readonly CoreWebVitalFailure[];
  metrics: {
    lcpMs: number | null;
    inpMs: number | null;
    cls: number | null;
  };
  budgets: typeof CORE_WEB_VITAL_BUDGETS;
}

export interface P75Evaluation {
  ok: boolean;
  status: "pass" | "fail";
  p75: number | null;
  sampleCount: number;
  reason: "invalid_sample" | "empty_samples" | null;
}

export type FirstProofTimestamp = string | number;

export interface FirstProofClockInput {
  createdAt?: FirstProofTimestamp | null;
  watchlistCreatedAt?: FirstProofTimestamp | null;
  queuedAt: FirstProofTimestamp | null | undefined;
  processingStartedAt: FirstProofTimestamp | null | undefined;
  finishedAt: FirstProofTimestamp | null | undefined;
  proofSucceededAt: FirstProofTimestamp | null | undefined;
}

export type FirstProofClockFailure =
  | "created_at_missing"
  | "created_at_invalid"
  | "queued_at_missing"
  | "queued_at_invalid"
  | "processing_started_at_missing"
  | "processing_started_at_invalid"
  | "finished_at_missing"
  | "finished_at_invalid"
  | "proof_succeeded_at_missing"
  | "proof_succeeded_at_invalid"
  | "timestamps_nonmonotonic";

export interface FirstProofClockEvaluation {
  ok: boolean;
  status: "pass" | "fail";
  failures: readonly FirstProofClockFailure[];
  durations: {
    configureToQueueMs: number | null;
    queueWaitMs: number | null;
    executionMs: number | null;
    configureToProofMs: number | null;
  };
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Computes p75 using the nearest-rank definition (ceil(0.75 * n)).
 * Invalid or empty evidence fails closed instead of silently dropping samples.
 */
export function evaluateP75(samples: readonly unknown[]): P75Evaluation {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      ok: false,
      status: "fail",
      p75: null,
      sampleCount: 0,
      reason: "empty_samples",
    };
  }

  if (!samples.every(isFiniteNonNegativeNumber)) {
    return {
      ok: false,
      status: "fail",
      p75: null,
      sampleCount: samples.length,
      reason: "invalid_sample",
    };
  }

  const ordered = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil(ordered.length * 0.75);
  const p75 = ordered[rank - 1];

  return {
    ok: true,
    status: "pass",
    p75: p75 ?? null,
    sampleCount: samples.length,
    reason: null,
  };
}

export function evaluateCoreWebVitals(input: {
  lcpMs?: unknown;
  inpMs?: unknown;
  lcp?: unknown;
  inp?: unknown;
  cls?: unknown;
} | null | undefined): CoreWebVitalsEvaluation {
  const measurements = input ?? {};
  const lcpValue = measurements.lcpMs ?? measurements.lcp;
  const inpValue = measurements.inpMs ?? measurements.inp;
  const metrics = {
    lcpMs: isFiniteNonNegativeNumber(lcpValue) ? lcpValue : null,
    inpMs: isFiniteNonNegativeNumber(inpValue) ? inpValue : null,
    cls: isFiniteNonNegativeNumber(measurements.cls) ? measurements.cls : null,
  };
  const failures: CoreWebVitalFailure[] = [];

  if (lcpValue === null || lcpValue === undefined) failures.push("lcp_missing");
  else if (metrics.lcpMs === null) failures.push("lcp_invalid");
  else if (metrics.lcpMs > CORE_WEB_VITAL_BUDGETS.lcpMs) failures.push("lcp_budget_exceeded");

  if (inpValue === null || inpValue === undefined) failures.push("inp_missing");
  else if (metrics.inpMs === null) failures.push("inp_invalid");
  else if (metrics.inpMs > CORE_WEB_VITAL_BUDGETS.inpMs) failures.push("inp_budget_exceeded");

  if (measurements.cls === null || measurements.cls === undefined) failures.push("cls_missing");
  else if (metrics.cls === null) failures.push("cls_invalid");
  else if (metrics.cls > CORE_WEB_VITAL_BUDGETS.cls) failures.push("cls_budget_exceeded");

  const ok = failures.length === 0;
  return {
    ok,
    status: ok ? "pass" : "fail",
    failures,
    metrics,
    budgets: CORE_WEB_VITAL_BUDGETS,
  };
}

function parseTimestamp(value: FirstProofTimestamp | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Evaluates the authoritative first-proof lifecycle without echoing raw
 * timestamps. Every stage is required so an incomplete lifecycle cannot look
 * like a measured success.
 */
export function evaluateFirstProofClock(
  input: FirstProofClockInput | null | undefined,
): FirstProofClockEvaluation {
  const timestamps: Partial<FirstProofClockInput> = {
    ...(input ?? {}),
    createdAt: input?.createdAt ?? input?.watchlistCreatedAt,
  };
  const values = {
    createdAt: parseTimestamp(timestamps.createdAt),
    queuedAt: parseTimestamp(timestamps.queuedAt),
    processingStartedAt: parseTimestamp(timestamps.processingStartedAt),
    finishedAt: parseTimestamp(timestamps.finishedAt),
    proofSucceededAt: parseTimestamp(timestamps.proofSucceededAt),
  };
  const failures: FirstProofClockFailure[] = [];

  const required: Array<[
    "createdAt" | "queuedAt" | "processingStartedAt" | "finishedAt" | "proofSucceededAt",
    FirstProofClockFailure,
    FirstProofClockFailure,
  ]> = [
    ["createdAt", "created_at_missing", "created_at_invalid"],
    ["queuedAt", "queued_at_missing", "queued_at_invalid"],
    ["processingStartedAt", "processing_started_at_missing", "processing_started_at_invalid"],
    ["finishedAt", "finished_at_missing", "finished_at_invalid"],
    ["proofSucceededAt", "proof_succeeded_at_missing", "proof_succeeded_at_invalid"],
  ];
  for (const [key, missingFailure, invalidFailure] of required) {
    const raw = timestamps[key];
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
      failures.push(missingFailure);
    } else if (values[key] === null) {
      failures.push(invalidFailure);
    }
  }

  const ordered = [
    values.createdAt,
    values.queuedAt,
    values.processingStartedAt,
    values.finishedAt,
    values.proofSucceededAt,
  ];
  if (ordered.every((value): value is number => value !== null)) {
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]! < ordered[index - 1]!) {
        failures.push("timestamps_nonmonotonic");
        break;
      }
    }
  }

  const ok = failures.length === 0;
  if (!ok) {
    return {
      ok: false,
      status: "fail",
      failures,
      durations: {
        configureToQueueMs: null,
        queueWaitMs: null,
        executionMs: null,
        configureToProofMs: null,
      },
    };
  }

  return {
    ok: true,
    status: "pass",
    failures: [],
    durations: {
      configureToQueueMs: values.queuedAt! - values.createdAt!,
      queueWaitMs: values.processingStartedAt! - values.queuedAt!,
      executionMs: values.finishedAt! - values.processingStartedAt!,
      configureToProofMs: values.proofSucceededAt! - values.createdAt!,
    },
  };
}
