"use client";

import { useDeferredValue, useState, useTransition } from "react";

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

export function SearchDemo() {
  const [mode, setMode] = useState<SearchMode>("advertiser");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [selectedId, setSelectedId] = useState(demoAds[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(filters.query);

  const activeFilters = { ...filters, query: deferredQuery };
  const filteredAds = demoAds.filter((ad) => matchesAd(ad, mode, activeFilters));
  const selectedAd =
    filteredAds.find((ad) => ad.id === selectedId) ?? filteredAds[0] ?? null;
  const isLoading = isPending || deferredQuery !== filters.query;

  const advertiserCount = new Set(filteredAds.map((ad) => ad.advertiser)).size;
  const activeFilterCount = [
    filters.country,
    filters.creativeType,
    filters.platform,
    filters.status,
  ].filter((value) => value !== "all").length + (filters.query.trim() ? 1 : 0);

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
                  onClick={() => {
                    startTransition(() => setMode(searchMode));
                  }}
                  role="tab"
                  type="button"
                >
                  {searchMode === "advertiser" ? "Advertiser" : "Keyword"}
                </button>
              ))}
            </div>
            <span className="stat-pill">
              {demoAds.length} example ads in the demo
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

              startTransition(() => {
                setFilters((current) => ({
                  ...current,
                  query: nextQuery,
                }));
              });
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
              onChange={(value) => {
                startTransition(() => {
                  setFilters((current) => ({ ...current, country: value }));
                });
              }}
              options={countries}
              value={filters.country}
            />
            <SelectField
              label="Platform"
              onChange={(value) => {
                startTransition(() => {
                  setFilters((current) => ({ ...current, platform: value }));
                });
              }}
              options={platforms}
              value={filters.platform}
            />
            <SelectField
              label="Status"
              onChange={(value) => {
                startTransition(() => {
                  setFilters((current) => ({
                    ...current,
                    status: value as SearchFilters["status"],
                  }));
                });
              }}
              options={[
                { label: "All statuses", value: "all" },
                { label: "Active", value: "active" },
                { label: "Paused", value: "paused" },
              ]}
              value={filters.status}
            />
            <SelectField
              label="Creative"
              onChange={(value) => {
                startTransition(() => {
                  setFilters((current) => ({
                    ...current,
                    creativeType: value as SearchFilters["creativeType"],
                  }));
                });
              }}
              options={creativeTypes}
              value={filters.creativeType}
            />
          </div>

          <div className="sample-queries">
            {sampleQueries[mode].map((query) => (
              <button
                className="sample-pill"
                key={query}
                onClick={() => {
                  startTransition(() => {
                    setFilters((current) => ({
                      ...current,
                      query,
                    }));
                  });
                }}
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
              {filteredAds.length} ads across {advertiserCount} advertisers
            </strong>
            <span>
              {activeFilterCount > 0
                ? `${activeFilterCount} active filters shaping the view`
                : "No filters applied yet"}
            </span>
          </div>
          <button
            className="filter-pill"
            onClick={() => {
              startTransition(() => {
                setFilters(defaultFilters);
              });
            }}
            type="button"
          >
            Reset filters
          </button>
        </div>

        {isLoading ? (
          <div className="skeleton-grid" aria-hidden="true">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        ) : filteredAds.length === 0 ? (
          <div className="empty-state">
            <p className="eyebrow">No results</p>
            <h3>No ads match that combination yet.</h3>
            <p>
              Try a broader query, clear one of the filters, or switch between
              advertiser and keyword mode.
            </p>
          </div>
        ) : (
          <div className="result-grid">
            {filteredAds.map((ad) => (
              <AdCard
                ad={ad}
                isSelected={selectedAd?.id === ad.id}
                key={ad.id}
                onSelect={() => setSelectedId(ad.id)}
              />
            ))}
          </div>
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
          </>
        ) : (
          <div className="empty-state">
            <p className="eyebrow">Nothing selected</p>
            <h3>Pick an ad to inspect the detail view.</h3>
          </div>
        )}
      </aside>
    </section>
  );
}

function AdCard({
  ad,
  isSelected,
  onSelect,
}: {
  ad: AdRecord;
  isSelected: boolean;
  onSelect: () => void;
}) {
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
