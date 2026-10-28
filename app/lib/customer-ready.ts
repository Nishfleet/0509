const HOLD_DEADLINE_MS = 72 * 60 * 60 * 1000;

export function holdDeadlinePassed(closesAt: Date, now: Date): boolean {
  return now.getTime() - closesAt.getTime() >= HOLD_DEADLINE_MS;
}

export function weekSendable(input: { unjudgedInputs: number; holdDeadlinePassed: boolean }): boolean {
  return input.unjudgedInputs === 0 || input.holdDeadlinePassed;
}
