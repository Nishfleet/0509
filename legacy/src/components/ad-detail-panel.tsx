"use client";

import { useEffect, useState } from "react";

import { type AdRecord } from "@/lib/demo-data";

export function AdDetailPanel({
  ad,
  allAds,
  onClose,
  onSelectAd,
}: {
  ad: AdRecord | null;
  allAds: AdRecord[];
  onClose: () => void;
  onSelectAd: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reset copied state when ad changes
  useEffect(() => {
    setCopied(false);
  }, [ad?.id]);

  if (!ad) return null;

  const relatedAds = allAds.filter(
    (a) => a.advertiser === ad.advertiser && a.id !== ad.id,
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ad.copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback for unsupported clipboard API
      const el = document.createElement("textarea");
      el.value = ad.copy;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  return (
    <>
      <div
        aria-hidden
        className="detail-panel-overlay"
        onClick={onClose}
      />
      <aside
        aria-label="Ad detail"
        className="detail-panel"
        role="complementary"
      >
        {/* Top bar */}
        <div className="detail-panel-topbar">
          <p className="eyebrow">Ad detail</p>
          <button
            aria-label="Close panel"
            className="detail-panel-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Creative preview */}
        <div
          className="creative-swatch detail-panel-swatch"
          style={{ "--swatch-accent": ad.preview.accent } as React.CSSProperties}
        >
          <span>{ad.preview.badge}</span>
          <strong>{ad.preview.headline}</strong>
          <small>{ad.preview.subhead}</small>
        </div>

        {/* Advertiser + status */}
        <div className="detail-panel-advertiser">
          <div>
            <h3>{ad.advertiser}</h3>
            <p className="detail-panel-hook">{ad.hook}</p>
          </div>
          <span
            className={`preview-status${ad.status === "active" ? " status-active" : ""}`}
          >
            {ad.status}
          </span>
        </div>

        {/* Platform + creative type badges */}
        <div className="detail-panel-badges">
          {ad.platforms.map((p) => (
            <span className="ad-badge" key={p}>
              {p}
            </span>
          ))}
          <span className="ad-badge">{ad.creativeType}</span>
        </div>

        {/* Full ad copy with copy button */}
        <div className="detail-copy-block">
          <div className="detail-copy-header">
            <strong>Ad copy</strong>
            <button
              className={`detail-copy-btn${copied ? " is-copied" : ""}`}
              onClick={() => void handleCopy()}
              type="button"
            >
              {copied ? "Copied!" : "Copy text"}
            </button>
          </div>
          <p className="detail-copy-text">{ad.copy}</p>
        </div>

        {/* Metadata grid */}
        <div className="detail-meta-grid">
          <div className="detail-meta-item">
            <span className="detail-meta-label">Countries</span>
            <span className="detail-meta-value">{ad.countries.join(", ")}</span>
          </div>
          <div className="detail-meta-item">
            <span className="detail-meta-label">Active dates</span>
            <span className="detail-meta-value">
              {ad.firstSeen} – {ad.lastSeen}
            </span>
          </div>
          <div className="detail-meta-item">
            <span className="detail-meta-label">Call to action</span>
            <span className="detail-meta-value">{ad.cta}</span>
          </div>
          <div className="detail-meta-item">
            <span className="detail-meta-label">Creative type</span>
            <span className="detail-meta-value">{ad.creativeType}</span>
          </div>
        </div>

        {/* Landing page */}
        <div className="detail-landing">
          <span className="detail-meta-label">Landing page</span>
          <a
            className="detail-link detail-landing-link"
            href={ad.landingPage}
            rel="noreferrer"
            target="_blank"
          >
            {ad.landingPage} ↗
          </a>
        </div>

        {/* Research note */}
        <div className="detail-research">
          <span className="detail-meta-label">Research note</span>
          <p>{ad.researchNote}</p>
        </div>

        {/* Angle + keyword tags */}
        <div className="detail-panel-tags">
          {ad.angleTags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        {/* Related ads from same advertiser */}
        {relatedAds.length > 0 && (
          <div className="detail-related">
            <p className="detail-meta-label">More from {ad.advertiser}</p>
            <div className="detail-related-list">
              {relatedAds.map((related) => (
                <button
                  className="detail-related-card"
                  key={related.id}
                  onClick={() => onSelectAd(related.id)}
                  type="button"
                >
                  <div
                    className="creative-swatch detail-related-swatch"
                    style={
                      {
                        "--swatch-accent": related.preview.accent,
                      } as React.CSSProperties
                    }
                  >
                    <strong>{related.preview.headline}</strong>
                    <small>{related.preview.subhead}</small>
                  </div>
                  <div className="detail-related-info">
                    <span className="detail-related-hook">{related.hook}</span>
                    <span className="ad-badge">{related.status}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
