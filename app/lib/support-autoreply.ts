export type AutoReplySkip = "unauthenticated" | "automated" | "bulk" | "robot_sender" | "own_domain" | "bad_sender";

const ROBOT_LOCAL_PARTS =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|daemon)([+._-]|$)/i;
const BULK_PRECEDENCE = /^(bulk|junk|list)$/i;
const OWN_DOMAINS = new Set(["0509.io", "0509.in"]);
const AUTH_PASS = /\bdmarc=pass\b/i;

function senderSkip(sender: string): AutoReplySkip | null {
  const at = sender.lastIndexOf("@");
  if (at <= 0 || at === sender.length - 1) return "bad_sender";
  if (OWN_DOMAINS.has(sender.slice(at + 1).toLowerCase())) return "own_domain";
  return ROBOT_LOCAL_PARTS.test(sender.slice(0, at)) ? "robot_sender" : null;
}

function isAutomated(headers: Headers): boolean {
  const autoSubmitted = headers.get("auto-submitted");
  return (
    (autoSubmitted !== null && autoSubmitted.trim().toLowerCase() !== "no") || headers.has("x-auto-response-suppress")
  );
}

function isBulk(headers: Headers): boolean {
  return (
    headers.has("list-id") ||
    headers.has("list-unsubscribe") ||
    BULK_PRECEDENCE.test(headers.get("precedence")?.trim() ?? "")
  );
}

export function autoReplySkip(headers: Headers, sender: string): AutoReplySkip | null {
  const fromSender = senderSkip(sender);
  if (fromSender !== null) return fromSender;
  if (isAutomated(headers)) return "automated";
  if (isBulk(headers)) return "bulk";
  return AUTH_PASS.test(headers.get("authentication-results") ?? "") ? null : "unauthenticated";
}
