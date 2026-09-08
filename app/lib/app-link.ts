import type { AppSession } from "~/lib/types";

/**
 * Auth-aware target for a signed-in-only app route when it is linked from a
 * public page. Signed-in visitors keep the direct app URL; anonymous
 * visitors (and crawlers) go straight to the login page with the app route
 * preserved as the post-login destination — exactly the final URL the
 * app-route guard would redirect to, minus the redirect hop, so no internal
 * link on a public page bounces the crawler.
 */
export function appLinkTarget(
  appPath: string,
  session: AppSession | null | undefined,
): string {
  if (session) {
    return appPath;
  }
  return `/auth/login?redirectTo=${encodeURIComponent(appPath)}`;
}
