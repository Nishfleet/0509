import { ONBOARDING_IDENTITY_PATH } from "../onboarding-subject";

export const MCP_PATH = "/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const READ_SCOPE = "read";
export const API_KEY_PREFIX = "0509_";

const BASE = "https://base.invalid";

const RETURN_TO_PATHS: ReadonlySet<string> = new Set([AUTHORIZE_PATH, ONBOARDING_IDENTITY_PATH]);

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/app";
  const url = new URL(value, BASE);
  if (url.origin !== BASE || !RETURN_TO_PATHS.has(url.pathname)) return "/app";
  return `${url.pathname}${url.search}`;
}
