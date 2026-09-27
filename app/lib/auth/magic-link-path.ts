export const MAGIC_LINK_PATH = "/sign-in/magic-link";
const AUTH_BASE_PATH = "/api/auth";

export function magicLinkRequestURL(authUrl: string): URL {
  return new URL(`${AUTH_BASE_PATH}${MAGIC_LINK_PATH}`, authUrl);
}
