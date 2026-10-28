import { isRouteErrorResponse } from "react-router";

export interface ErrorCopy {
  title: string;
  detail: string;
  retry: boolean;
  action?: { href: string; label: string };
}

export function errorCopy(error: unknown, pathname: string): ErrorCopy {
  const status = isRouteErrorResponse(error) ? error.status : null;
  if (status === 404) {
    return {
      title: "Page not found",
      detail: `There is no page at ${pathname}. Check the address, or go back to the home page.`,
      retry: false,
    };
  }
  if (status === 401) {
    return {
      title: "Sign in to continue",
      detail: "You need to be signed in to open this page. Sign in, then open it again.",
      retry: false,
      action: { href: "/login", label: "Sign in" },
    };
  }
  if (status === 403) {
    return {
      title: "You can't open this page",
      detail: "This page belongs to another account. Sign in with the right one, or go back to the home page.",
      retry: false,
    };
  }
  if (status === 429) {
    return {
      title: "Too many requests",
      detail: "You made a lot of requests in a short time. Wait a minute, then try again.",
      retry: true,
    };
  }
  return {
    title: "We hit a problem on our side",
    detail: "We have been alerted. Try again in a minute.",
    retry: true,
  };
}
