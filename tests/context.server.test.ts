import { afterEach, describe, expect, it } from "vitest";
import { RouterContextProvider } from "react-router";

import { cloudflareRuntimeContext, getEnv } from "~/lib/context.server";

type GlobalEnvCarrier = typeof globalThis & {
  __APP_REQUEST_ENV__?: Record<string, unknown>;
};

afterEach(() => {
  delete (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__;
});

describe("getEnv", () => {
  it("reads the React Router v8 context provider", () => {
    const context = new RouterContextProvider();
    context.set(cloudflareRuntimeContext, {
      env: { APP_NAME: "0509-provider" },
      ctx: {} as ExecutionContext,
      country: "IN",
    });

    expect(getEnv(context).APP_NAME).toBe("0509-provider");
  });

  it("merges request-time worker bindings back into the route context env", () => {
    (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__ = {
      BROWSER: { fetch: async () => new Response() },
      APP_NAME: "0509",
    };

    const env = getEnv({
      cloudflare: {
        env: {
          DB: { prepare: () => null },
          APP_NAME: "0509-from-context",
        },
        ctx: {} as ExecutionContext,
        country: "IN",
      },
    });

    expect(env.BROWSER).toBeTruthy();
    expect(env.DB).toBeTruthy();
    expect(env.APP_NAME).toBe("0509-from-context");
  });
});
