const DEFAULT_TIMEOUT_MS = 10_000;

type FetchInitWithTimeout = RequestInit & {
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchInitWithTimeout = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...fetchInit } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  function abortFromCaller() {
    controller.abort(signal?.reason);
  }

  if (signal?.aborted) {
    clearTimeout(timeout);
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    return await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
