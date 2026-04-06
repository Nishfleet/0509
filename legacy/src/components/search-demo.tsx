"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

import { AdDetailPanel } from "@/components/ad-detail-panel";
import {
  countries,
  creativeTypes,
  demoAds,
  platforms,
  searchModes,
  type AdRecord,
  type SearchFilters,
  type SearchMode,
} from "@/lib/demo-data";

const sampleQueries: Record<SearchMode, string[]> = {
  advertiser: ["motiondesk", "sienna skin", "parcelpilot", "ledgerloop"],
  keyword: ["free trial", "retention", "spf 50", "inventory sync"],
};

const defaultFilters: SearchFilters = {
  country: "all",
  creativeType: "all",
  platform: "all",
  query: "",
  status: "all",
};

// Used for client-side demo fallback filtering
function matchesAd(ad: AdRecord, mode: SearchMode, filters: SearchFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase();

  const searchableKeywordFields = [
    ad.advertiser,
    ad.hook,
    ad.copy,
    ad.cta,
    ad.preview.headline,
    ad.preview.subhead,
    ...ad.angleTags,
    ...ad.keywords,
  ]
    .join(" ")
    .toLowerCase();

  const queryMatch =
    normalizedQuery.length === 0
      ? true
      : mode === "advertiser"
        ? ad.advertiser.toLowerCase().includes(normalizedQuery)
        : searchableKeywordFields.includes(normalizedQuery);

  const countryMatch =
    filters.country === "all" ? true : ad.countries.includes(filters.country);

  const platformMatch =
    filters.platform === "all" ? true : ad.platforms.includes(filters.platform);

  const statusMatch =
    filters.status === "all" ? true : ad.status === filters.status;

  const creativeTypeMatch =
    filters.creativeType === "all"
      ? true
      : ad.creativeType === filters.creativeType;

  return (
    queryMatch &&
    countryMatch &&
    platformMatch &&
    statusMatch &&
    creativeTypeMatch
  );
}

type SearchResult = {
  ads: AdRecord[];
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  source: "meta" | "demo" | null;
};

// bookmark row id keyed by ad.id
type BookmarkMap = Record<string, string>;

export function SearchDemo() {
  const [mode, setMode] = useState<SearchMode>("advertiser");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [selectedId, setSelectedId] = useState(demoAds[0]?.id ?? "");
  const [panelAdId, setPanelAdId] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [result, setResult] = useState<SearchResult>({
    ads: demoAds,
    loading: false,
    error: null,
    nextCursor: null,
    source: "demo",
  });

  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, []);

  // Save search state
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Bookmark state: ad.id → bookmark row id
  const [bookmarkMap, setBookmarkMap] = useState<BookmarkMap>({});
  const [bookmarkingId, setBookmarkingId] = useState<string | null>(null);

  // Load existing bookmarks on mount (when logged in)
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((data: { bookmarks?: Array<{ id: string; ad_data: AdRecord }> }) => {
        if (!data.bookmarks) return;
        const map: BookmarkMap = {};
        for (const b of data.bookmarks) {
          if (b.ad_data?.id) map[b.ad_data.id] = b.id;
        }
        setBookmarkMap(map);
      })
      .catch(() => {/* silently ignore — bookmarks are enhancement, not core */});
  }, [isLoggedIn]);

  // Debounce query input (300ms) — other filter changes apply immediately
  const [debouncedQuery, setDebouncedQuery] = useState(filters.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(filters.query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters.query]);

  const fetchAds = useCallback(
    async (
      activeFilters: SearchFilters,
      activeMode: SearchMode,
      cursor?: string,
      append = false,
    ) => {
      const params = new URLSearchParams();
      params.set("q", activeFilters.query);
      params.set("mode", activeMode);
      if (activeFilters.country !== "all")
        params.set("country", activeFilters.country);
      if (activeFilters.platform !== "all")
        params.set("platform", activeFilters.platform);
      if (activeFilters.status !== "all")
        params.set("status", activeFilters.status);
      if (activeFilters.creativeType !== "all")
        params.set("creativeType", activeFilters.creativeType);
      if (cursor) params.set("after", cursor);

      if (append) {
        setIsLoadingMore(true);
      } else {
        setResult((prev) => ({ ...prev, loading: true, error: null }));
      }

      try {
        const res = await fetch(`/api/ads/search?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          ads: AdRecord[];
          nextCursor: string | null;
          source: "meta" | "demo";
        };

        // When the API returns unfiltered demo data, filter client-side
        const ads =
          data.source === "demo"
            ? data.ads.filter((ad) => matchesAd(ad, activeMode, activeFilters))
            : data.ads;

        setResult((prev) => ({
          ads: append ? [...prev.ads, ...ads] : ads,
          loading: false,
          error: null,
          nextCursor: data.nextCursor,
          source: data.source,
        }));
      } catch (err) {
        // Graceful fallback: filter demo data locally
        const fallback = demoAds.filter((ad) =>
          matchesAd(ad, activeMode, activeFilters),
        );
        setResult((prev) => ({
          ads: append ? prev.ads : fallback,
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : "Search failed. Showing demo data.",
          nextCursor: null,
          source: "demo",
        }));
      } finally {
        if (append) setIsLoadingMore(false);
      }
    },
    [],
  );

  // Re-fetch when debounced query or other filter values change
  useEffect(() => {
    fetchAds({ ...filters, query: debouncedQuery }, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedQuery,
    filters.country,
    filters.platform,
    filters.status,
    filters.creativeType,
    mode,
    fetchAds,
  ]);

  // Keep selection pointing at a valid ad after results change
  useEffect(() => {
    if (result.ads.length > 0 && !result.ads.find((ad) => ad.id === selectedId)) {
      setSelectedId(result.ads[0].id);
    }
  }, [result.ads, selectedId]);

  const handleLoadMore = () => {
    if (result.nextCursor && !isLoadingMore) {
      fetchAds(
        { ...filters, query: debouncedQuery },
        mode,
        result.nextCursor,
        true,
      );
    }
  };

  const handleSaveSearch = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const queryParams: Record<string, string> = {
        q: debouncedQuery,
        mode,
        country: filters.country,
        platform: filters.platform,
        status: filters.status,
        creativeType: filters.creativeType,
      };
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), query_params: queryParams }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        throw new Error(body.error ?? "Failed to save");
      }
      setSaveSuccess(true);
      setShowSaveForm(false);
      setSaveName("");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // silently ignore — user can retry
    } finally {
      setSaving(false);
    }
  };

  const handleBookmark = async (ad: AdRecord) => {
    if (!isLoggedIn) {
      window.location.href = "/auth/login";
      return;
    }
    setBookmarkingId(ad.id);
    const existing = bookmarkMap[ad.id];
    try {
      if (existing) {
        // Unbookmark
        await fetch(`/api/bookmarks/${existing}`, { method: "DELETE" });
        setBookmarkMap((prev) => {
          const next = { ...prev };
          delete next[ad.id];
          return next;
        });
      } else {
        // Bookmark
        const res = await fetch("/api/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad_data: ad }),
        });
        if (res.ok) {
          const data = (await res.json()) as { bookmark: { id: string } };
          setBookmarkMap((prev) => ({ ...prev, [ad.id]: data.bookmark.id }));
        }
      }
    } catch {
      // silently ignore
    } finally {
      setBookmarkingId(null);
    }
  };

  const { ads, loading, error, nextCursor, source } = result;
  const selectedAd = ads.find((ad) => ad.id === selectedId) ?? ads[0] ?? null;
  const panelAd = panelAdId
    ? (ads.find((ad) => ad.id === panelAdId) ?? null)
    : null;
  const advertiserCount = new Set(ads.map((ad) => ad.advertiser)).size;
  const activeFilterCount =
    [
      filters.country,
      filters.creativeType,
      filters.platform,
      filters.status,
    ].filter((v) => v !== "all").length + (filters.query.trim() ? 1 : 0);

  return (
    <section className="container search-layout">
      <div className="search-panel">
        <div className="search-topbar">
          <div>
            <p className="eyebrow">Live demo</p>
            <h2>Search by advertiser or keyword.</h2>
          </div>
          <div className="toolbar-row">
            <div className="mode-switch" role="tablist" aria-label="Search mode">
              {searchModes.map((searchMode) => (
                <button
                  aria-selected={searchMode === mode}
                  className={searchMode === mode ? "is-current" : undefined}
                  key={searchMode}
                  onClick={() => setMode(searchMode)}
                  role="tab"
                  type="button"
                >
                  {searchMode === "advertiser" ? "Advertiser" : "Keyword"}
                </button>
              ))}
            </div>
            <span
              className={`stat-pill${source === "meta" ? " source-live" : ""}`}
            >
              {source === "meta" ? "Live data" : "Demo data"}
            </span>
          </div>
        </div>

        <div className="search-form">
          <label className="sr-only" htmlFor="search-query">
            Search query
          </label>
          <input
            className="search-input"
            id="search-query"
            onChange={(event) => {
              const nextQuery = event.target.value;
              setFilters((current) => ({ ...current, query: nextQuery }));
            }}
            placeholder={
              mode === "advertiser"
                ? "Search for a competitor brand"
                : "Search for offer language or keywords"
            }
            value={filters.query}
          />

          <div className="filter-row">
            <SelectField
              label="Country"
              onChange={(value) =>
                setFilters((current) => ({ ...current, country: value }))
              }
              options={countries}
              value={filters.country}
            />
            <SelectField
              label="Platform"
              onChange={(value) =>
                setFilters((current) => ({ ...current, platform: value }))
              }
              options={platforms}
              value={filters.platform}
            />
            <SelectField
              label="Status"
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  status: value as SearchFilters["status"],
                }))
              }
              options={[
                { label: "All statuses", value: "all" },
                { label: "Active", value: "active" },
                { label: "Paused", value: "paused" },
              ]}
              value={filters.status}
            />
            <SelectField
              label="Creative"
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  creativeType: value as SearchFilters["creativeType"],
                }))
              }
              options={creativeTypes}
              value={filters.creativeType}
            />
          </div>

          <div className="sample-queries">
            {sampleQueries[mode].map((query) => (
              <button
                className="sample-pill"
                key={query}
                onClick={() =>
                  setFilters((current) => ({ ...current, query }))
                }
                type="button"
              >
                {query}
              </button>
            ))}
          </div>
        </div>

        <div className="results-header">
          <div className="results-summary">
            <strong>
              {loading
                ? "Searching\u2026"
                : `${ads.length} ad${ads.length !== 1 ? "s" : ""} across ${advertiserCount} advertiser${advertiserCount !== 1 ? "s" : ""}`}
            </strong>
            <span>
              {activeFilterCount > 0
                ? `${activeFilterCount} active filter${activeFilterCount > 1 ? "s" : ""} shaping the view`
                : "No filters applied yet"}
            </span>
          </div>
          <div className="results-actions">
            <button
              className="filter-pill"
              onClick={() => setFilters(defaultFilters)}
              type="button"
            >
              Reset filters
            </button>
            {saveSuccess ? (
              <span className="save-success-pill">Saved!</span>
            ) : (
              <button
                className="filter-pill save-search-btn"
                onClick={() => {
                  if (!isLoggedIn) {
                    window.location.href = "/auth/login";
                    return;
                  }
                  setShowSaveForm((v) => !v);
                  setSaveName(debouncedQuery || "My search");
                }}
                type="button"
              >
                {showSaveForm ? "Cancel" : "Save search"}
              </button>
            )}
          </div>
        </div>

        {showSaveForm ? (
          <div className="save-search-form">
            <input
              autoFocus
              className="search-input save-name-input"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveSearch();
                if (e.key === "Escape") setShowSaveForm(false);
              }}
              placeholder="Name this search…"
              value={saveName}
            />
            <button
              className="button button-primary"
              disabled={saving || !saveName.trim()}
              onClick={() => void handleSaveSearch()}
              type="button"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="error-banner" role="alert">
            <span>Showing demo data.</span>
            <span className="error-detail">{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="skeleton-results" role="status" aria-label="Loading results">
            <span className="sr-only">Loading results…</span>
            <div className="skeleton-grid" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div className="skeleton-badges-row">
                    <div className="skeleton-badge" />
                    <div className="skeleton-badge skeleton-badge--short" />
                  </div>
                  <div className="skeleton-swatch" />
                  <div className="skeleton-title" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-line--short" />
                </div>
              ))}
            </div>
          </div>
        ) : ads.length === 0 ? (
          <div className="empty-state">
            <p className="eyebrow">No results</p>
            <h3>No ads match that combination yet.</h3>
            <p>
              Try a broader query, clear one of the filters, or switch between
              advertiser and keyword mode.
            </p>
          </div>
        ) : (
          <>
            <div className="result-grid">
              {ads.map((ad) => (
                <AdCard
                  ad={ad}
                  bookmarkRowId={bookmarkMap[ad.id]}
                  isBookmarking={bookmarkingId === ad.id}
                  isSelected={selectedAd?.id === ad.id}
                  key={ad.id}
                  onBookmark={() => void handleBookmark(ad)}
                  onSelect={() => {
                    setSelectedId(ad.id);
                    setPanelAdId(ad.id);
                  }}
                />
              ))}
            </div>
            {nextCursor ? (
              <button
                className="load-more-btn"
                disabled={isLoadingMore}
                onClick={handleLoadMore}
                type="button"
              >
                {isLoadingMore ? "Loading\u2026" : "Load more ads"}
              </button>
            ) : null}
          </>
        )}
      </div>

      <aside className="search-detail">
        {selectedAd ? (
          <>
            <div className="detail-topbar">
              <p className="eyebrow">Selected ad</p>
              <span className="preview-status">{selectedAd.status}</span>
            </div>
            <div
              className="creative-swatch"
              style={
                {
                  "--swatch-accent": selectedAd.preview.accent,
                } as React.CSSProperties
              }
            >
              <span>{selectedAd.preview.badge}</span>
              <strong>{selectedAd.preview.headline}</strong>
              <small>{selectedAd.preview.subhead}</small>
            </div>

            <div className="detail-summary" style={{ marginTop: 20 }}>
              <p>{selectedAd.advertiser}</p>
              <span>{selectedAd.hook}</span>
            </div>

            <div className="detail-list">
              <article>
                <strong>Offer snapshot</strong>
                <span>{selectedAd.copy}</span>
              </article>
              <article>
                <strong>Call to action</strong>
                <span>{selectedAd.cta}</span>
              </article>
              <article>
                <strong>Landing page</strong>
                <a
                  className="detail-link"
                  href={selectedAd.landingPage}
                  rel="noreferrer"
                  target="_blank"
                >
                  {selectedAd.landingPage}
                </a>
              </article>
              <article>
                <strong>Research note</strong>
                <span>{selectedAd.researchNote}</span>
              </article>
            </div>

            <div className="detail-tags">
              {selectedAd.angleTags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>

            <button
              className="detail-open-panel-btn"
              onClick={() => setPanelAdId(selectedAd.id)}
              type="button"
            >
              View full details →
            </button>
          </>
        ) : (
          <div className="empty-state">
            <p className="eyebrow">Nothing selected</p>
            <h3>Pick an ad to inspect the detail view.</h3>
          </div>
        )}
      </aside>

      {/* Slide-out detail panel */}
      {panelAd && (
        <AdDetailPanel
          ad={panelAd}
          allAds={ads}
          onClose={() => setPanelAdId(null)}
          onSelectAd={(id) => {
            setSelectedId(id);
            setPanelAdId(id);
          }}
        />
      )}
    </section>
  );
}

function AdCard({
  ad,
  bookmarkRowId,
  isBookmarking,
  isSelected,
  onBookmark,
  onSelect,
}: {
  ad: AdRecord;
  bookmarkRowId: string | undefined;
  isBookmarking: boolean;
  isSelected: boolean;
  onBookmark: () => void;
  onSelect: () => void;
}) {
  const isBookmarked = !!bookmarkRowId;

  return (
    <article className={`search-card${isSelected ? " is-selected" : ""}`}>
      <button onClick={onSelect} type="button">
        <div className="search-card-header">
          <span className="ad-badge">{ad.creativeType}</span>
          <span className="ad-badge">{ad.platforms.join(" / ")}</span>
        </div>
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
        <div>
          <h3>{ad.advertiser}</h3>
          <p className="card-copy">{ad.hook}</p>
        </div>
        <div className="card-footer">
          <span className="search-meta">
            {ad.firstSeen} to {ad.lastSeen}
          </span>
          <span className="search-meta">{ad.countries.join(", ")}</span>
        </div>
      </button>
      <button
        aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this ad"}
        className={`bookmark-btn${isBookmarked ? " is-bookmarked" : ""}`}
        disabled={isBookmarking}
        onClick={(e) => {
          e.stopPropagation();
          onBookmark();
        }}
        title={isBookmarked ? "Remove bookmark" : "Save this ad"}
        type="button"
      >
        {isBookmarked ? "★" : "☆"}
      </button>
    </article>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        className="search-select"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
