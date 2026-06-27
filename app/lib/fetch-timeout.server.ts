export interface FetchWithTimeoutOptions {
  fetcher?: typeof fetch;
  timeoutMs: number;
}

const FETCH_TIMEOUT_CLEANUP = Symbol("fetchTimeoutCleanup");

type TimeoutResponse = Response & {
  [FETCH_TIMEOUT_CLEANUP]?: () => void;
};

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
