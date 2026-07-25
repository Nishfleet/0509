import { createContext, type RouterContextProvider } from "react-router";

import type { CloudflareRuntimeContext } from "~/lib/env.server";

export const cloudflareRuntimeContext = createContext<CloudflareRuntimeContext>();

export function getOptionalCloudflareContext(
  context: unknown,
): CloudflareRuntimeContext | undefined {
  if (
    context &&
    typeof context === "object" &&
    "get" in context &&
    typeof context.get === "function"
  ) {
    return (context as Readonly<RouterContextProvider>).get(cloudflareRuntimeContext);
  }

  return (context as { cloudflare?: CloudflareRuntimeContext } | null | undefined)?.cloudflare;
}

export function getCloudflareContext(context: unknown): CloudflareRuntimeContext {
  const cloudflare = getOptionalCloudflareContext(context);
  if (!cloudflare) {
    throw new Error("Cloudflare runtime context is unavailable");
  }
  return cloudflare;
}
