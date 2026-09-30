// The eval runs in node and calls Jev over HTTP, but the app modules it imports to
// get the shipped state builders reach `env` at import time. This stands in for the
// cloudflare:workers module so those imports resolve; no binding is ever called
// through it, and a call that did would throw rather than silently succeed.
export const env = new Proxy<Record<string, never>>({} as Record<string, never>, {
  get(_target, property) {
    throw new Error(`no binding ${String(property)} in the eval runtime; Jev is called over HTTP`);
  },
});
