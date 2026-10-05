import { env } from "cloudflare:workers";

export function loader() {
  return Response.json({
    status: "ok",
    app: "0509",
    timestamp: new Date().toISOString(),
    // The commit that is live (#7187). The version_metadata binding is the
    // stock way to read the deployed version's tag, and the tag is set at
    // deploy time: the deploy step passes the pushed SHA as the tag, so
    // production names the exact commit. The platform injects the value, so
    // this probe still reads nothing — no D1, no KV, no R2.
    commit: env.VERSION_METADATA.tag,
  });
}
