import { LocalTime } from "~/components/local-time";
import { readDigestStrategyNote } from "~/lib/digest-strategy";

/**
 * AI weekly summary panel for a selected digest. Self-contained: takes the
 * raw digest_run summary object, extracts the stored paragraph, and renders
 * nothing at all when no paragraph was persisted — absence is silent.
 */
export function DigestStrategyNote({
	summary,
}: {
	summary?: Record<string, unknown> | null;
}) {
	const note = readDigestStrategyNote(summary);
	if (!note) {
		return null;
	}

	return (
		<section aria-label="AI summary of the week" className="f9-proof-packet">
			<div>
				<span className="f9-app-kicker">AI summary of the week</span>
				<h3>What competitors did this week</h3>
				<p className="f9-muted-copy">
					Written by AI from the changes logged in this digest. Check the items below before acting.
					{note.generatedAt ? (
						<>
							{" "}Generated <LocalTime iso={note.generatedAt} />.
						</>
					) : null}
				</p>
			</div>
			<p>{note.paragraph}</p>
		</section>
	);
}
