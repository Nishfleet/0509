import { env } from "cloudflare:workers";

import { renderDescriptorTemplate } from "../ads/descriptor";
import { transportBrowser, type BrowserBindingLike } from "../ads/transport-browser";
import { metaAdlibDescriptor, type AdlibQuery } from "./generators/meta-adlib";
import type { AdlibPage } from "./meta-adlib-run.server";

function browserBinding(): BrowserBindingLike | null {
  const candidate: unknown = Reflect.get(env, "BROWSER");
  if (typeof candidate !== "object" || candidate === null) return null;
  if (typeof Reflect.get(candidate, "fetch") !== "function") return null;
  if (typeof Reflect.get(candidate, "quickAction") !== "function") return null;
  return candidate as BrowserBindingLike;
}

export async function pullMetaAdlib(query: AdlibQuery): Promise<AdlibPage> {
  const descriptor = metaAdlibDescriptor(query.market);
  const searchUrl = renderDescriptorTemplate(descriptor.endpoint, { target: query.category });
  const browser = browserBinding();
  if (browser === null) {
    console.error(JSON.stringify({ event: "discovery.meta_adlib_no_browser" }));
    return { status: 0, html: "", searchUrl };
  }
  const result = await transportBrowser(descriptor, query.category, { BROWSER: browser });
  const html = typeof result.payload === "string" ? result.payload : "";
  return { status: result.status, html, searchUrl };
}
