export interface OutboundMail {
  to: string;
  from: string | { email: string; name?: string };
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}

export interface MailBinding {
  send(message: OutboundMail): Promise<unknown>;
}

export function unsubscribeUrl(token: string): string {
  return `https://0509.io/u/${token}`;
}

export function listUnsubscribeHeaders(token: string): Record<string, string> {
  const url = unsubscribeUrl(token);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sendMail(EMAIL: MailBinding, message: OutboundMail): Promise<string> {
  const response: unknown = await EMAIL.send(message);
  if (typeof response === "object" && response !== null && "messageId" in response) {
    const messageId = response.messageId;
    if (typeof messageId === "string") return messageId;
  }
  return "";
}
