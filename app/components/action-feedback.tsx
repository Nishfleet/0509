import type { ReactNode } from "react";
import { Link } from "react-router";

export type ActionFeedbackData = {
	ok: boolean;
	message?: string;
	displayMessage?: string;
	intent?: string;
} & Record<string, unknown>;

export interface ActionFeedbackProps {
	data?: ActionFeedbackData | null;
	/**
	 * Render only when the action result carries one of these intents. Place
	 * the slot next to the form that owns the intent so feedback appears where
	 * the customer just acted, not at the top of the page.
	 */
	intent?: string | string[];
	/**
	 * Render only intent-less results. Use one fallback slot per page so
	 * legacy or unscoped returns still surface somewhere visible.
	 */
	fallback?: boolean;
	/**
	 * Extra fields echoed by the action (row ids) that must match, so repeated
	 * forms (one per row) only show feedback on the row that submitted.
	 */
	match?: Record<string, unknown>;
	/**
	 * Billing link appended when the result carries error "plan_limit_exceeded"
	 * (e.g. "/app/billing?source=collections#plans").
	 */
	planLimitTo?: string;
	/** Extra content appended after the message (share URL + copy button). */
	children?: ReactNode;
}

export function ActionFeedback({
	data,
	intent,
	fallback,
	match,
	planLimitTo,
	children,
}: ActionFeedbackProps) {
	if (!data) {
		return null;
	}
	const message = actionFeedbackMessage(data);
	if (!message) return null;
	if (fallback && data.intent !== undefined) {
		return null;
	}
	if (intent !== undefined) {
		const intents = Array.isArray(intent) ? intent : [intent];
		if (typeof data.intent !== "string" || !intents.includes(data.intent)) {
			return null;
		}
	}
	if (
		match &&
		!Object.entries(match).every(([field, expected]) => data[field] === expected)
	) {
		return null;
	}

	const showPlanLimitLink =
		Boolean(planLimitTo) && data.error === "plan_limit_exceeded";

	// Key on outcome + message so a successive error (e.g. review_required →
	// review_stale) remounts the live region. Reusing one node and only swapping
	// text can fail both screen-reader re-announcement and Playwright
	// hasText waits when the previous assertive alert is still the same node.
	// The key is React-only and never reaches the HTML, so it can hold the raw
	// message safely. Do NOT also render it as an attribute: the message would
	// then appear twice in the markup, and the server-render tests count
	// occurrences of the message text and require exactly one.
	const outcomeKey = `${data.ok ? "ok" : "err"}:${String(data.error ?? "")}:${message}`;

	return (
		<div
			key={outcomeKey}
			aria-atomic="true"
			aria-live={data.ok ? "polite" : "assertive"}
			className={`f9-wk-notice f9-action-feedback ${data.ok ? "is-success" : "is-error"}`}
			role={data.ok ? "status" : "alert"}
		>
			<p>
				{message}
				{showPlanLimitLink ? (
					<>
						{" "}
						<Link to={planLimitTo as string}>View plans</Link> to raise the limit.
					</>
				) : null}
				{children}
			</p>
		</div>
	);
}

function actionFeedbackMessage(data: ActionFeedbackData) {
	if (typeof data.displayMessage === "string" && data.displayMessage.trim()) {
		return data.displayMessage.trim();
	}
	if (typeof data.message !== "string" || !data.message.trim()) return null;
	if (/^https?:\/\//i.test(data.message.trim())) {
		if (data.intent === "share-collection") return "Share link created.";
		if (data.intent === "share-report") return "Snapshot link created.";
	}
	return data.message;
}
