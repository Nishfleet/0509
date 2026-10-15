import { z } from "zod";

import { isUnsubscribeTokenKnown, suppressByUnsubscribeToken } from "./data/email_suppression.server";
import type { SuppressionScope } from "./mail-kind";

export type UnsubscribeOutcome = "unsubscribed" | "invalid_token";

const scopeSchema = z.enum(["brief", "alerts", "all"]).catch("all");

export function unsubscribeScope(value: unknown): SuppressionScope {
  return scopeSchema.parse(value);
}

export async function unsubscribe(token: string | undefined, scope: SuppressionScope): Promise<UnsubscribeOutcome> {
  if (token === undefined || token === "") return "invalid_token";
  if (!(await isUnsubscribeTokenKnown(token))) return "invalid_token";
  await suppressByUnsubscribeToken(token, scope);
  return "unsubscribed";
}
