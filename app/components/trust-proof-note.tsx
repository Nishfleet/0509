import { Link } from "react-router";

import {
  CAPTURE_RULES_PUBLIC_PATH,
  NO_PHANTOM_CHANGES_PUBLIC_PATH,
} from "~/lib/capture-validity-public-rules";

/**
 * Compact proof-trust element for conversion surfaces (the anonymous signup
 * wall after /search and /pricing). It states the honest one-line guarantee
 * the product can actually back up — "if we send it, the page really changed"
 * — and links to the two published proof pages: /no-phantom-changes (the
 * checkable capture-validity guarantee) and /capture-rules (the rule set).
 *
 * Copy is limited to what those published pages claim: no boast beyond the
 * stated guarantee (issues #2026, #2049). Rendering it on every surface that
 * asks a visitor for an email puts the differentiator next to the ask.
 */
export function TrustProofNote({
  className = "",
}: {
  className?: string;
}) {
  return (
    <p className={`f9-wk-dim f9-ads-proof-note ${className}`.trim()}>
      {"No phantom changes: if we send it, the page really changed. "}
      <Link to={NO_PHANTOM_CHANGES_PUBLIC_PATH}>
        Read the capture-validity guarantee
      </Link>
      {" · "}
      <Link to={CAPTURE_RULES_PUBLIC_PATH}>What counts as a real change</Link>
    </p>
  );
}