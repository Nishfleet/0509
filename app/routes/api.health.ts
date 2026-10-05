import { env } from "cloudflare:workers";

export function loader() {
  return Response.json({
    status: "ok",
    app: "0509",
    timestamp: new Date().toISOString(),
    // The commit that is live (#7187). The deploy workflow tags every Worker
    // version with the pushed SHA, and the version_metadata binding is the
    // stock way to read that tag back. The platform injects the value at
    // deploy time, so this probe still reads nothing — no D1, no KV, no R2.
    commit: env.VERSION_METADATA.tag,
  });
}
