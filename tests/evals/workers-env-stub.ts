export const env = new Proxy<Record<string, never>>({} as Record<string, never>, {
  get(_target, property) {
    throw new Error(`no binding ${String(property)} in the eval runtime; Jev is called over HTTP`);
  },
});
