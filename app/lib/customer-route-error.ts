export interface CustomerRouteError {
  title: string;
  message: string;
  retryable: boolean;
}

const INTERNAL_INFRA_PATTERN = /\b(d1|workflow|binding)\b/i;

function sanitizeCustomerMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "An unexpected error occurred. Try again or contact support.";
  }
  if (INTERNAL_INFRA_PATTERN.test(trimmed)) {
    return "This feature is temporarily unavailable. Try again later.";
  }
  return trimmed;
}

export function mapCustomerRouteError(error: unknown): CustomerRouteError {
  if (error instanceof Response) {
    if (error.status === 404) {
      return {
        title: "Not found",
        message: "This page or item is no longer available.",
        retryable: false,
      };
    }
    if (error.status === 403) {
      return {
        title: "Access denied",
        message: "You do not have permission to view this.",
        retryable: false,
      };
    }
    if (error.status >= 500) {
      return {
        title: "Something went wrong",
        message: "Five to Nine hit a server error. Try again in a moment.",
        retryable: true,
      };
    }
    return {
      title: "Request failed",
      message: "We could not load this page. Try again or contact support.",
      retryable: true,
    };
  }

  if (error instanceof Error) {
    const normalized = error.message.toLowerCase();
    if (
      normalized.includes("not configured") ||
      normalized.includes("d1") ||
      normalized.includes("binding") ||
      normalized.includes("workflow")
    ) {
      return {
        title: "Service unavailable",
        message: "This feature is temporarily unavailable. Try again later.",
        retryable: true,
      };
    }
    if (normalized.includes("rate limit") || normalized.includes("too many")) {
      return {
        title: "Slow down",
        message: "Too many requests. Wait a minute and try again.",
        retryable: true,
      };
    }
    return {
      title: "Something went wrong",
      message: sanitizeCustomerMessage(error.message),
      retryable: true,
    };
  }

  return {
    title: "Something went wrong",
    message: "An unexpected error occurred. Try again or contact support.",
    retryable: true,
  };
}
