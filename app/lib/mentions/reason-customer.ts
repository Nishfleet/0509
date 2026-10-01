import { type NoulAction } from "../jev/thresholds";

export const MENTION_MATTERS_WHEN_TRUE = "It reports a move or an event you would want to act on or bring up.";

export const MENTION_MATTERS_WHEN_FALSE =
  "It is a passing mention, one name in a long list, a stock price line, or old news retold.";

const REASON_LINES: Readonly<Record<NoulAction, string>> = {
  act: MENTION_MATTERS_WHEN_TRUE,
  maybe: "It may be a move worth knowing, but we were not sure enough to put it in your brief.",
  reject: MENTION_MATTERS_WHEN_FALSE,
};

export function mentionReasonLine(action: NoulAction): string {
  return REASON_LINES[action];
}
