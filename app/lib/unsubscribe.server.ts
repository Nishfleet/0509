import { suppressByUnsubscribeToken } from "./data/email_suppression.server";

export async function unsubscribe(token: string | undefined): Promise<void> {
  if (token !== undefined && token !== "") {
    await suppressByUnsubscribeToken(token);
  }
}
