export interface FetchWithTimeoutOptions {
  fetcher?: typeof fetch;
  timeoutMs: number;
}

const FETCH_TIMEOUT_CLEANUP = Symbol("fetchTimeoutCleanup");

type TimeoutResponse = Response & {
  [FETCH_TIMEOUT_CLEANUP]?: () => void;
};

export class PromiseTimeoutError extends Error {
  constructor(message = "Operation timed out.") {
    super(message);
    this.name = "PromiseTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const { signal, cleanup } = signalWithTimeout(init?.signal, options.timeoutMs);

  try {
    const response = await fetcher(input, { ...init, signal });
    return attachTimeoutCleanup(response, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function promiseWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out.",
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;
  const watchedOperation = operation.then((value) => {
    if (didTimeout && onLateResolve) {
      void Promise.resolve(onLateResolve(value)).catch(() => undefined);
    }
    return value;
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      didTimeout = true;
      reject(new PromiseTimeoutError(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([watchedOperation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function releaseFetchTimeout(response: Response) {
  const cleanup = (response as TimeoutResponse)[FETCH_TIMEOUT_CLEANUP];
  cleanup?.();
}

function signalWithTimeout(existingSignal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);

  if (existingSignal?.aborted) {
    abort();
  } else {
    existingSignal?.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      existingSignal?.removeEventListener("abort", abort);
    },
  };
}

function attachTimeoutCleanup(response: Response, cleanup: () => void): Response {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    cleanup();
  };
  const timeoutResponse = response as TimeoutResponse;
  timeoutResponse[FETCH_TIMEOUT_CLEANUP] = release;

  for (const method of ["arrayBuffer", "blob", "formData", "json", "text"] as const) {
    const original = response[method].bind(response);
    Object.defineProperty(response, method, {
      configurable: true,
      value: async () => {
        try {
          return await original();
        } finally {
          release();
        }
      },
    });
  }

  return response;
}
