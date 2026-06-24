export interface CustomerRouteError {
  title: string;
  message: string;
  retryable: boolean;
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
    if (normalized.includes("not configured") || normalized.includes("d1 binding")) {
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
      message: error.message || "An unexpected error occurred.",
      retryable: true,
    };
  }

  return {
    title: "Something went wrong",
    message: "An unexpected error occurred. Try again or contact support.",
    retryable: true,
  };
}
