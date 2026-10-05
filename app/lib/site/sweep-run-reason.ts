export interface SweepStepFailure {
  step: string;
  error: string;
}

const MAX_STEPS_IN_REASON = 5;
const MAX_ERROR_CHARS = 120;

export function sweepRunReason(failures: readonly SweepStepFailure[], failedPages: number, pages: number): string | null {
  if (failures.length === 0) return null;
  const named = failures.slice(0, MAX_STEPS_IN_REASON).map((failure) => {
    const error = failure.error.length > MAX_ERROR_CHARS ? `${failure.error.slice(0, MAX_ERROR_CHARS)}...` : failure.error;
    return `${failure.step}: ${error}`;
  });
  const rest = failures.length - named.length;
  if (rest > 0) named.push(`${String(rest)} more`);
  const steps = `${String(failures.length)} ${failures.length === 1 ? "step" : "steps"}`;
  return [`${String(failedPages)} of ${String(pages)} pages failed in ${steps}`, named.join("; ")].join(": ");
}
