const DEAD_LINK_CODES = new Set(["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]);

export const DEAD_LINK_MESSAGE = "That sign-in link has expired or was already used. Enter your email for a new one.";

export function deadLinkMessage(search: URLSearchParams): string | null {
  const code = search.get("error");
  return code !== null && DEAD_LINK_CODES.has(code) ? DEAD_LINK_MESSAGE : null;
}
