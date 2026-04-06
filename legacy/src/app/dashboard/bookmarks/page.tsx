import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AdRecord } from "@/lib/demo-data";

type Bookmark = {
  id: string;
  ad_data: AdRecord;
  notes: string;
  created_at: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BookmarksPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: bookmarks } = await supabase
    .from("bookmarked_ads")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const items = (bookmarks ?? []) as Bookmark[];

  return (
    <div className="dashboard-shell container">
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Bookmarked ads</h2>
          <p className="dashboard-subtitle">{user.email}</p>
        </div>
        <nav className="dashboard-nav">
          <Link href="/dashboard" className="button button-secondary">
            Saved searches
          </Link>
          <Link href="/search" className="button button-primary">
            New search
          </Link>
        </nav>
      </div>

      {items.length === 0 ? (
        <div className="dashboard-empty">
          <p className="eyebrow">No bookmarks yet</p>
          <h3>Save an ad to keep it forever.</h3>
          <p>
            Bookmarked ads are stored in full — they persist even if the
            original ad is pulled from Meta.
          </p>
          <Link href="/search" className="button button-primary">
            Start searching
          </Link>
        </div>
      ) : (
        <div className="bookmark-grid">
          {items.map((item) => (
            <BookmarkCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookmarkCard({ item }: { item: Bookmark }) {
  const ad = item.ad_data;

  async function deleteBookmark() {
    "use server";
    const supabase = await createServerSupabaseClient();
    await supabase.from("bookmarked_ads").delete().eq("id", item.id);
    redirect("/dashboard/bookmarks");
  }

  return (
    <article className="bookmark-card">
      <div
        className="creative-swatch"
        style={
          {
            "--swatch-accent": ad.preview.accent,
          } as React.CSSProperties
        }
      >
        <span>{ad.preview.badge}</span>
        <strong>{ad.preview.headline}</strong>
        <small>{ad.preview.subhead}</small>
      </div>

      <div className="bookmark-card-body">
        <div className="bookmark-card-header">
          <h3 className="bookmark-advertiser">{ad.advertiser}</h3>
          <div className="bookmark-badges">
            <span className="ad-badge">{ad.creativeType}</span>
            <span className="ad-badge">{ad.status}</span>
          </div>
        </div>
        <p className="bookmark-hook">{ad.hook}</p>
        <p className="bookmark-date">Saved {formatDate(item.created_at)}</p>
      </div>

      <div className="bookmark-card-footer">
        <div className="bookmark-tags">
          {ad.angleTags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <form action={deleteBookmark}>
          <button type="submit" className="button button-danger bookmark-delete">
            Remove
          </button>
        </form>
      </div>
    </article>
  );
}
