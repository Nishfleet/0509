import { suppressByUnsubscribeToken } from "./data/email_suppression.server";

export const UNSUBSCRIBE_CONFIRMATION =
  "You are unsubscribed. No more email will be sent to this address.";

export async function unsubscribe(token: string | undefined): Promise<Response> {
  if (token !== undefined && token !== "") {
    await suppressByUnsubscribeToken(token);
  }
  return new Response(UNSUBSCRIBE_CONFIRMATION, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
