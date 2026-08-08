import type { ReactNode } from "react";
import { Link } from "react-router";

import { IconEmpty } from "~/components/icons";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; to: string };
	/** Optional secondary "See a sample" link, rendered beside the primary action (panel variant only). */
	sample?: { label: string; to: string };
	/** Heading element for the panel variant; keep page outlines coherent. */
	headingLevel?: "h2" | "h3";
	/**
	 * panel — dashed workspace card (default, f9-dash-state-empty)
	 * inline — single muted sentence inside an existing panel
	 * row — placeholder row inside an f9-wk-worklist
	 */
	variant?: "panel" | "inline" | "row";
	children?: ReactNode;
}

export function EmptyState({
	title,
	description,
	action,
	sample,
	headingLevel = "h2",
	variant = "panel",
	children,
}: EmptyStateProps) {
	if (variant === "inline") {
		// Title and description share one muted line; without terminal
		// punctuation they read as a run-on ("Nothing saved yet Collections
		// you create..."). Add a period only when a description follows and
		// the title doesn't already end a sentence.
		const leadNeedsStop = Boolean(description) && !/[.!?…]$/.test(title.trim());
		return (
			<p className="f9-wk-dim f9-empty-inline" role="status">
				{leadNeedsStop ? `${title}.` : title}
				{description ? <> {description}</> : null}
			</p>
		);
	}

	if (variant === "row") {
		return (
			<div className="f9-wk-workrow f9-empty-row" role="status">
				<div>
					<strong>{title}</strong>
					{description ? <p className="f9-wk-dim">{description}</p> : null}
				</div>
				{children}
			</div>
		);
	}

	const Heading = headingLevel;

  return (
    <div className="f9-dash-state f9-dash-state-empty" role="status">
			<IconEmpty className="f9-empty-state-icon" />
			<Heading>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {action || sample ? (
        <div className="f9-empty-actions">
          {action ? (
            <Link className="f9-wk-btn" to={action.to}>
              {action.label}
            </Link>
          ) : null}
          {sample ? (
            <Link className="f9-wk-btn-quiet" to={sample.to}>
              {sample.label}
            </Link>
          ) : null}
        </div>
      ) : null}
			{children}
    </div>
  );
}
