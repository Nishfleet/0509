import { isBillingRefusal } from "./refusal";

type JevFailureKind = "rate_limited" | "billing" | "timeout" | "bad_shape" | "other";

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

const ECHOED_INPUT = /"[^"]*"|'[^']*'|\S*@\S*|\S*:\/\/\S*|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;

function kindOf(raw: string): JevFailureKind {
  if (isBillingRefusal(raw)) return "billing";
  if (RATE_LIMITED.test(raw)) return "rate_limited";
  if (raw.includes(BAD_SHAPE)) return "bad_shape";
  return TIMEOUT.test(raw) ? "timeout" : "other";
}

export function classifyJevFailure(error: unknown): JevFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const kind = kindOf(raw);
  const text = kind === "bad_shape" ? raw : raw.replace(ECHOED_INPUT, "…");
  return {
    kind,
    code: PROVIDER_CODE.exec(raw)?.[1] ?? null,
    message: text.replace(PREFIX, "").replace(/\s+/g, " ").slice(0, MESSAGE_MAX),
  };
}
