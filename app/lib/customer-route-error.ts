import { isRouteErrorResponse } from "react-router";

export interface CustomerRouteError {
  title: string;
  message: string;
  retryable: boolean;
  category?: "permission" | "plan_limit" | "unavailable" | "not_found" | "unknown";
  recoveryAction?: "retry" | "support" | "upgrade" | "sign_in";
}

/**
 * Truthful recovery message for the anonymous public-search limiter
 * (20 searches / 10 minutes per IP, see enforcePublicSearchRateLimit).
 * Single source of truth: the /search loader puts it in the thrown 429 body
 * and the 429 mapping below renders it (or the body's own message) verbatim.
 */
export const PUBLIC_SEARCH_RATE_LIMIT_MESSAGE =
  "You've hit the anonymous search limit. Free search allows 20 searches per 10 minutes — wait a few minutes and try again.";

const INTERNAL_INFRA_PATTERN =
  /\b(d1|sql|sqlite|workflow|binding|wrangler|cloudflare|oauth|token|secret|stack trace)\b/i;
const INTERNAL_ROLLOUT_PATTERN = /\binternal\b.*\b(workspace|pilot|rollout)\b/i;
const STACK_TRACE_PATTERN = /\bat\s+[\w./<>]+\s*\(/i;
const JSON_BLOB_PATTERN = /^\s*[\[{]/;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function looksLikeInternalLeak(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return (
    INTERNAL_INFRA_PATTERN.test(trimmed) ||
    INTERNAL_ROLLOUT_PATTERN.test(trimmed) ||
    STACK_TRACE_PATTERN.test(trimmed) ||
    JSON_BLOB_PATTERN.test(trimmed) ||
    UUID_PATTERN.test(trimmed) ||
    trimmed.includes("SQLITE_") ||
    trimmed.includes("D1_ERROR") ||
    trimmed.includes("Error:")
  );
}

export function sanitizeCustomerMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "An unexpected error occurred. Try again or contact support.";
  }
  if (looksLikeInternalLeak(trimmed)) {
    return "This feature is temporarily unavailable. Try again later.";
  }
  if (EMAIL_PATTERN.test(trimmed) && trimmed.length > 120) {
    return "We could not complete that request. Try again or contact support.";
  }
  return trimmed;
}

export function sanitizeCustomerFacingMessage(message: string): string {
  return sanitizeCustomerMessage(message);
}

function messageFromUnknown(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    if ("error" in error && typeof error.error === "string") {
      return error.error;
    }
  }
  return null;
}

export function mapCustomerRouteError(error: unknown): CustomerRouteError {
  if (error instanceof Response || isRouteErrorResponse(error)) {
    const status = error.status;
    const statusText = error.statusText;

    if (status === 401) {
      return {
        title: "Sign in required",
        message: "Sign in again to continue.",
        retryable: false,
        category: "permission",
        recoveryAction: "sign_in",
      };
    }
    if (status === 404) {
      return {
        title: "Not found",
        message: "This page or item is no longer available.",
        retryable: false,
        category: "not_found",
      };
    }
    if (status === 403) {
      return {
        title: "Access denied",
        message: "You do not have permission to view this.",
        retryable: false,
        category: "permission",
      };
    }
    if (status === 402 || status === 409) {
      return {
        title: "Plan limit reached",
        message: "This action is not available on your current plan or usage level.",
        retryable: false,
        category: "plan_limit",
        recoveryAction: "upgrade",
      };
    }
    if (status === 429) {
      // Anonymous free-search throttling: show the limiter's own truthful
      // recovery message when the thrown 429 body carries one (React Router
      // puts the parsed body on RouteErrorResponse.data), otherwise the
      // shared default. Never the generic "Request failed" fallthrough.
      const thrownMessage = messageFromUnknown(
        error && typeof error === "object" && "data" in error
          ? (error as { data?: unknown }).data
          : null,
      );
      return {
        title: "Too many searches",
        message: sanitizeCustomerMessage(
          thrownMessage ?? PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
        ),
        retryable: true,
        category: "unavailable",
        recoveryAction: "retry",
      };
    }
    if (status === 503 && statusText === "Authentication temporarily unavailable") {
      return {
        title: "Temporarily unavailable",
        message: "Authentication is temporarily unavailable. Please try again in a moment.",
        retryable: true,
        category: "unavailable",
        recoveryAction: "retry",
      };
    }
    if (status >= 500) {
      return {
        title: "Something went wrong",
        message: "Five to Nine hit a server error. Try again in a moment.",
        retryable: true,
        category: "unavailable",
        recoveryAction: "retry",
      };
    }
    return {
      title: "Request failed",
      message: "We could not load this page. Try again or contact support.",
      retryable: true,
      category: "unknown",
      recoveryAction: "retry",
    };
  }

  if (error instanceof Error) {
    const normalized = error.message.toLowerCase();
    if (
      normalized.includes("not configured") ||
      normalized.includes("d1") ||
      normalized.includes("binding") ||
      normalized.includes("workflow") ||
      normalized.includes("timeout") ||
      normalized.includes("aborted")
    ) {
      return {
        title: "Service unavailable",
        message: "This feature is temporarily unavailable. Try again later.",
        retryable: true,
        category: "unavailable",
        recoveryAction: "retry",
      };
    }
    if (normalized.includes("rate limit") || normalized.includes("too many")) {
      return {
        title: "Slow down",
        message: "Too many requests. Wait a minute and try again.",
        retryable: true,
        category: "unavailable",
        recoveryAction: "retry",
      };
    }
    if (normalized.includes("plan") || normalized.includes("limit") || normalized.includes("upgrade")) {
      return {
        title: "Plan limit reached",
        message: sanitizeCustomerMessage(error.message),
        retryable: false,
        category: "plan_limit",
        recoveryAction: "upgrade",
      };
    }
  }

  const rawMessage = messageFromUnknown(error);
  if (rawMessage) {
    return {
      title: "Something went wrong",
      message: sanitizeCustomerMessage(rawMessage),
      retryable: true,
      category: "unknown",
      recoveryAction: "retry",
    };
  }

  return {
    title: "Something went wrong",
    message: "An unexpected error occurred. Try again or contact support.",
    retryable: true,
    category: "unknown",
    recoveryAction: "support",
  };
}
