// #7187: wrangler types does not yet emit the version_metadata binding into the
// generated Env (wrangler 4.147.0 mentions the binding only in a deprecation
// warning), so the shape the runtime injects is declared here, once: `id` and
// `tag`, both strings
// (https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).
declare global {
  namespace Cloudflare {
    interface Env {
      VERSION_METADATA: { id: string; tag: string };
    }
  }
}

export {};
