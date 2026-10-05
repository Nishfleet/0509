import { env } from "cloudflare:workers";

export function loader() {
  return Response.json({
    status: "ok",
    app: "0509",
    timestamp: new Date().toISOString(),
    commit: env.VERSION_METADATA.tag,
  });
}
