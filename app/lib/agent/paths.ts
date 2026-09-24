export const MCP_PATH = "/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const READ_SCOPE = "read";
export const API_KEY_PREFIX = "0509_";

const BASE = "https://base.invalid";

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/app";
  const url = new URL(value, BASE);
  if (url.origin !== BASE || url.pathname !== AUTHORIZE_PATH) return "/app";
  return `${url.pathname}${url.search}`;
}
