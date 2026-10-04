import { isBillingRefusal } from "./refusal";

export type JevFailureKind = "rate_limited" | "billing" | "timeout" | "bad_shape" | "other";

export interface JevFailure {
  kind: JevFailureKind;
  code: string | null;
  message: string;
}

export const RATE_LIMITED = /(^|\D)2003(\D|$)/;

const TIMEOUT = /timeout|timed out|aborted|deadline/i;

const BAD_SHAPE = "answer missing its";

const PROVIDER_CODE = /(?:^|\D)(\d{4})(?:\D|$)/;

const PREFIX = /^jev unavailable: /;

export const MESSAGE_MAX = 160;

function kindOf(raw: string): JevFailureKind {
  if (isBillingRefusal(raw)) return "billing";
  if (RATE_LIMITED.test(raw)) return "rate_limited";
  if (raw.includes(BAD_SHAPE)) return "bad_shape";
  return TIMEOUT.test(raw) ? "timeout" : "other";
}

export function classifyJevFailure(error: unknown): JevFailure {
  const raw = error instanceof Error ? error.message : String(error);
  return {
    kind: kindOf(raw),
    code: PROVIDER_CODE.exec(raw)?.[1] ?? null,
    message: raw.replace(PREFIX, "").replace(/\s+/g, " ").slice(0, MESSAGE_MAX),
  };
}
