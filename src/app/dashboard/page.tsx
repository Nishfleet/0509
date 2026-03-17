import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type SavedSearch = {
  id: string;
  name: string;
  query_params: Record<string, string>;
  run_count: number;
  created_at: string;
  last_run_at: string;
};

function buildSearchUrl(params: Record<string, string>): string {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.mode) q.set("mode", params.mode);
  if (params.country && params.country !== "all")
    q.set("country", params.country);
  if (params.platform && params.platform !== "all")
    q.set("platform", params.platform);
  if (params.status && params.status !== "all")
    q.set("status", params.status);
  if (params.creativeType && params.creativeType !== "all")
    q.set("creativeType", params.creativeType);
  return `/search?${q.toString()}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function queryParamsSummary(params: Record<string, string>): string {
  const parts: string[] = [];
  if (params.q) parts.push(`"${params.q}"`);
  if (params.mode && params.mode !== "keyword") parts.push(params.mode);
  if (params.country && params.country !== "all") parts.push(params.country);
  if (params.platform && params.platform !== "all")
    parts.push(params.platform);
  if (params.status && params.status !== "all") parts.push(params.status);
  if (params.creativeType && params.creativeType !== "all")
    parts.push(params.creativeType);
  return parts.length > 0 ? parts.join(" · ") : "All ads";
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: searches } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const savedSearches = (searches ?? []) as SavedSearch[];

  return (
    <div className="dashboard-shell container">
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Saved searches</h2>
          <p className="dashboard-subtitle">{user.email}</p>
        </div>
        <nav className="dashboard-nav">
          <Link href="/dashboard/bookmarks" className="button button-secondary">
            Bookmarks
          </Link>
          <Link href="/search" className="button button-primary">
            New search
          </Link>
        </nav>
      </div>

      {savedSearches.length === 0 ? (
        <div className="dashboard-empty">
          <p className="eyebrow">Nothing saved yet</p>
          <h3>Save a search to track it over time.</h3>
          <p>
            Run a search, then click &ldquo;Save search&rdquo; to pin it here.
            Each saved search can be re-run to see what competitors are running
            today.
          </p>
          <Link href="/search" className="button button-primary">
            Start searching
          </Link>
        </div>
      ) : (
        <div className="saved-search-list">
          {savedSearches.map((search) => (
            <SavedSearchCard key={search.id} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedSearchCard({ search }: { search: SavedSearch }) {
  const searchUrl = buildSearchUrl(search.query_params);

  return (
    <article className="saved-search-card">
      <div className="saved-search-main">
        <div className="saved-search-info">
          <h3 className="saved-search-name">{search.name}</h3>
          <p className="saved-search-params">
            {queryParamsSummary(search.query_params)}
          </p>
        </div>
        <div className="saved-search-meta">
          <span className="saved-search-stat">
            <strong>{search.run_count}</strong>
            <span>run{search.run_count !== 1 ? "s" : ""}</span>
          </span>
          <span className="saved-search-stat">
            <strong>Last run</strong>
            <span>{formatDate(search.last_run_at)}</span>
          </span>
          <span className="saved-search-stat">
            <strong>Saved</strong>
            <span>{formatDate(search.created_at)}</span>
          </span>
        </div>
      </div>
      <div className="saved-search-actions">
        <a href={searchUrl} className="button button-primary saved-search-run">
          Run search
        </a>
        <DeleteSearchButton id={search.id} />
      </div>
    </article>
  );
}

// Client component for delete — we import it inline using a wrapper
function DeleteSearchButton({ id }: { id: string }) {
  // Server action to delete
  async function deleteSearch() {
    "use server";
    const supabase = await createServerSupabaseClient();
    await supabase.from("saved_searches").delete().eq("id", id);
    redirect("/dashboard");
  }

  return (
    <form action={deleteSearch}>
      <button type="submit" className="button button-danger">
        Delete
      </button>
    </form>
  );
}
