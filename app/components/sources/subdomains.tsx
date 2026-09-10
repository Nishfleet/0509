import { useState } from "react";
import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";
import type { SubdomainSnapshotPayload } from "~/lib/sources/subdomains/subdomain-snapshot.server";

/**
 * New web addresses (subdomains via crt.sh) source section — issue #2198.
 *
 * Renders inside the existing presence-source section on the competitor
 * page. Renders nothing when there is no snapshot (the seam's SourceSections
 * passes null until the competitor page loads source data).
 *
 * Shows: a count, the newest 10 public names with firstSeen, an expandable
 * list of internal names, and a one-line explanation of what a new address
 * usually means.
 */
export function SubdomainsSection({
  snapshot,
  diff: _diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  const payload = parsePayload(snapshot);
  if (!payload) return null;

  const publicNames = payload.names.filter((n) => n.kind === "public");
  const internalNames = payload.names.filter((n) => n.kind === "internal");
  const newestPublic = publicNames.slice(0, 10);

  return (
    <section className="f9-source-section f9-source-section--subdomains" aria-label="New web addresses">
      <p className="f9-evidence-micro">New web addresses (Certificate Transparency)</p>
      <h3 className="f9-wk-mt0">New web addresses</h3>
      <p className="f9-wk-dim">
        {publicNames.length} public address{publicNames.length === 1 ? "" : "es"} seen in Certificate Transparency logs for{" "}
        {payload.domain}. A new address often means a new product surface is being built.
      </p>

      {newestPublic.length > 0 ? (
        <ul className="f9-source-list" data-source="subdomains">
          {newestPublic.map((entry) => (
            <li key={entry.name} className="f9-source-list-item">
              <span className="f9-source-list-name">{entry.name}</span>
              {entry.firstSeen ? (
                <span className="f9-source-list-date">first seen {formatDate(entry.firstSeen)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="f9-wk-dim">No public addresses found yet.</p>
      )}

      {internalNames.length > 0 ? (
        <InternalNamesList names={internalNames} />
      ) : null}

      {payload.truncated ? (
        <p className="f9-wk-dim">
          Showing the first 5,000 entries from crt.sh — the full list was truncated.
        </p>
      ) : null}
    </section>
  );
}

function InternalNamesList({ names }: { names: Array<{ name: string; firstSeen: string }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details className="f9-source-internal" onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary className="f9-evidence-micro">
        {names.length} internal address{names.length === 1 ? "" : "es"} (infrastructure, not product signals)
      </summary>
      {expanded ? (
        <ul className="f9-source-list f9-source-list--internal">
          {names.map((entry) => (
            <li key={entry.name} className="f9-source-list-item">
              <span className="f9-source-list-name">{entry.name}</span>
              {entry.firstSeen ? (
                <span className="f9-source-list-date">first seen {formatDate(entry.firstSeen)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function parsePayload(
  snapshot: SourceSnapshotRecord | null,
): SubdomainSnapshotPayload | null {
  if (!snapshot) return null;
  const payload = snapshot.payload as Partial<SubdomainSnapshotPayload>;
  if (typeof payload?.domain !== "string" || !Array.isArray(payload?.names)) {
    return null;
  }
  return payload as SubdomainSnapshotPayload;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
