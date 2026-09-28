import { env } from "cloudflare:workers";

import { renderDescriptorTemplate } from "../ads/descriptor";
import { transportBrowser } from "../ads/transport-browser";
import { metaAdlibDescriptor, type AdlibQuery } from "./generators/meta-adlib";
import type { AdlibPage } from "./meta-adlib-run.server";

export async function pullMetaAdlib(query: AdlibQuery): Promise<AdlibPage> {
  const descriptor = metaAdlibDescriptor(query.market);
  const searchUrl = renderDescriptorTemplate(descriptor.endpoint, { target: query.category });
  const result = await transportBrowser(descriptor, query.category, { BROWSER: env.BROWSER });
  const html = typeof result.payload === "string" ? result.payload : "";
  return { status: result.status, html, searchUrl };
}
