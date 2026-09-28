import {
  isUnsubscribeTokenKnown,
  suppressByUnsubscribeToken,
} from "./data/email_suppression.server";

export type UnsubscribeOutcome = "unsubscribed" | "invalid_token";

/**
 * Suppresses the address behind a live unsubscribe token, and says so only
 * when a row actually landed.
 *
 * A token is a random value in `send_target.unsubscribe_token`; the address
 * change sets it back to NULL, so a link that has been rotated, truncated by
 * a mail client, or typed by hand belongs to no target. That is a 404, not a
 * success: telling a reader "you are unsubscribed" while their mail keeps
 * arriving is the quiet failure this closes (0509#5761).
 */
export async function unsubscribe(token: string | undefined): Promise<UnsubscribeOutcome> {
  if (token === undefined || token === "") return "invalid_token";
  if (!(await isUnsubscribeTokenKnown(token))) return "invalid_token";
  await suppressByUnsubscribeToken(token);
  return "unsubscribed";
}
