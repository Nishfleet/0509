import type { Route } from "./+types/app.alerts";

import { MentionRow, SourcePills } from "../components/mention-row";
import { loadMentionFeed, loadSourceLines } from "../lib/data/mentions.server";
import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const showAll = new URL(request.url).searchParams.get("all") === "1";
  const [mentions, sources] = await Promise.all([
    loadMentionFeed(session.user.id, showAll),
    loadSourceLines(session.user.id),
  ]);
  return { email: session.user.email, mentions, sources, showAll };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Alerts</h1>
      <p>Signed in as {loaderData.email}</p>
      <SourcePills lines={loaderData.sources.lines} allDown={loaderData.sources.allDown} />
      {loaderData.showAll ? null : (
        <p>
          <a href="?all=1">show all</a>
        </p>
      )}
      {loaderData.mentions.map((mention) => (
        <MentionRow key={mention.id} mention={mention} />
      ))}
    </main>
  );
}
