import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const origin = new URL(request.url).origin;
  return Response.json(
    {
      name: "Five to Nine Customer API",
      status: "live",
      auth: {
        type: "bearer",
        header: "Authorization: Bearer <Five to Nine API key>",
        createKeysIn: `${origin}/app/sources`,
      },
      endpoints: [
        {
          method: "POST",
          path: "/api/mcp",
          formats: ["mcp-json-rpc"],
        },
        {
          method: "GET",
          path: "/api/v1/workspace-readiness",
          formats: ["json"],
        },
        {
          method: "POST",
          path: "/api/v1/actions",
          formats: ["json"],
          actions: [
            "watchlist.create",
            "watchlist.update",
            "watchlist.refresh",
            "watchlist.pause",
            "watchlist.resume",
            "collection.create",
            "proof.add_external",
            "share.create",
            "report.create",
            "report.share",
            "counter_move_brief.create",
            "memory.upsert",
            "memory.list",
            "client_room.upsert",
            "client_room.list",
            "delivery_targets.list",
            "delivery_settings.update",
            "delivery_target.update",
            "web_mentions.list",
          ],
        },
        {
          method: "GET",
          path: "/api/v1/collections/{collectionId}",
          formats: ["json", "csv", "slack"],
        },
        {
          method: "GET",
          path: "/api/v1/watchlists/{watchlistId}",
          formats: ["json", "csv", "slack"],
        },
        {
          method: "GET",
          path: "/api/v1/digests/{digestId}",
          formats: ["json", "csv", "slack"],
        },
      ],
      liveDataScope: [
        "Meta ad proof saved in this account",
        "Landing-page proof captured by this account",
        "Watchlist changes and digest items owned by this account",
        "Manual external proof links, scoped memory, client rooms, redacted delivery settings, and existing web mention observations owned by this account",
      ],
      notLiveYet: [
        "TikTok ingestion",
        "Google or YouTube ingestion",
        "LinkedIn or Pinterest ingestion",
        "fully general write API beyond audited agent actions",
      ],
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
