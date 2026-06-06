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
      ],
      notLiveYet: [
        "TikTok ingestion",
        "Google or YouTube ingestion",
        "LinkedIn or Pinterest ingestion",
        "public write API",
      ],
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
