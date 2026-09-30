import { isUnsubscribeTokenKnown, suppressByUnsubscribeToken } from "./data/email_suppression.server";

export type UnsubscribeOutcome = "unsubscribed" | "invalid_token";

export async function unsubscribe(token: string | undefined): Promise<UnsubscribeOutcome> {
  if (token === undefined || token === "") return "invalid_token";
  if (!(await isUnsubscribeTokenKnown(token))) return "invalid_token";
  await suppressByUnsubscribeToken(token);
  return "unsubscribed";
}
