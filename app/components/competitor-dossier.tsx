import { meterWidthClass } from "~/lib/meter-width";
import { Link } from "react-router";

import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
import {
	type AggressionScore,
	MIN_AGGRESSION_WINDOW_DAYS,
} from "~/lib/aggression-score";
import { ANGLE_DISPLAY } from "~/lib/angle-display";
import type { CounterBrief } from "~/lib/counter-brief.server";
import type {
	CompetitorDossier,
	DossierAdHistoryEntry,
	DossierAngleMix,
	DossierVelocity,
} from "~/lib/competitor-dossier.server";

/**
 * "Intelligence" section on the watchlist detail page: what this watchlist's
 * accumulated observation history adds up to. Renders the honest
 * "builds after a few scans" state below two healthy scans — never a fake
 * insight. Chart follows the WatchlistTrends accessibility pattern:
 * inline SVG with role="img" and a spoken aria-label, no chart library.
 */
export function CompetitorDossierPanel({
	dossier,
	watchlistId,
	aggression = null,
	counterBrief = null,
	counterBriefLocked = false,
}: {
	dossier: CompetitorDossier;
	watchlistId: string;
	aggression?: AggressionScore | null;
	counterBrief?: CounterBrief | null;
	/** True on free plans: renders the upgrade line instead of a brief. */
	counterBriefLocked?: boolean;
}) {
	return (
		<section aria-label="Competitor intelligence">
			<div className="f9-panel-toolbar">
				<div>
					<p className="f9-wk-kick">Intelligence</p>
					<h3 className="f9-wk-mt0">What this history adds up to</h3>
				</div>
				{dossier.status === "ready" ? (
					<p className="f9-dossier-window">
						Observed since <LocalTime iso={dossier.observedSince} mode="date" /> ·{" "}
						{dossier.scanCount} scans
					</p>
				) : null}
			</div>
			{dossier.status === "not_enough_history" ? (
				<p className="f9-trend-sparse">
					Intelligence builds after a few scans — longevity, hook patterns, and launch velocity
					need at least two checks of real history before they mean anything. Keep this watchlist
					running and this section fills in on its own.
				</p>
			) : (
				<div className="f9-dossier-body">
					<dl className="f9-dossier-stats">
						<div className="f9-dossier-stat">
							<dt>Ads tracked</dt>
							<dd>{dossier.adHistory.length}</dd>
						</div>
						<div className="f9-dossier-stat">
							<dt>Active now</dt>
							<dd>{dossier.activeCount}</dd>
						</div>
						<div className="f9-dossier-stat">
							<dt>Formats</dt>
							<dd className="is-formats">
								{dossier.formatMix
									.map((share) => `${share.count} ${share.format}`)
									.join(" · ")}
							</dd>
						</div>
					</dl>

					<AggressionScorecard aggression={aggression} />

					<div>
						<p className="f9-dossier-subhead">Angles</p>
						<AngleMixRow angleMix={dossier.angleMix} />
					</div>

					<div>
						<p className="f9-dossier-subhead">Proven runners</p>
						{dossier.longevityLeaders.length === 0 ? (
							<p className="f9-wk-dim">No longevity signal yet.</p>
						) : (
							<div className="f9-dossier-leaders">
								{dossier.longevityLeaders.map((leader) => (
									<LongevityLeaderCard key={leader.metaAdId} leader={leader} />
								))}
							</div>
						)}
					</div>

					<div>
						<p className="f9-dossier-subhead">Recurring hooks</p>
						{dossier.hookPatterns.length === 0 ? (
							<p className="f9-wk-dim">
								No hook opening repeats yet — every observed ad leads differently.
							</p>
						) : (
							<ul className="f9-dossier-hooks">
								{dossier.hookPatterns.map((pattern) => (
									<li key={pattern.pattern}>
										<span className="f9-dossier-hook-text">“{pattern.sample}…”</span>
										<span className="f9-dossier-hook-count">×{pattern.count}</span>
									</li>
								))}
							</ul>
						)}
					</div>

					<div>
						<p className="f9-dossier-subhead">New ads per week</p>
						<VelocityBars velocity={dossier.adVelocity} />
						<p className="f9-trend-note">
							First observed by this watchlist, per ISO week
							{dossier.adVelocity.earlierCount > 0
								? ` · +${dossier.adVelocity.earlierCount} first observed earlier`
								: ""}{" "}
							— from retained scan history.
						</p>
					</div>

					<p className="f9-dossier-changes">
						{dossier.landingPageChanges.count === 0 ? (
							"No confirmed landing-page changes in the observed window."
						) : (
							<>
								{dossier.landingPageChanges.count} confirmed landing-page change
								{dossier.landingPageChanges.count === 1 ? "" : "s"}
								{dossier.landingPageChanges.latest ? (
									<>
										{" "}
										· latest <LocalTime iso={dossier.landingPageChanges.latest.createdAt} mode="date" /> ·{" "}
										<Link
											to={`/app/watchlists?watchlist=${watchlistId}&event=${dossier.landingPageChanges.latest.eventId}`}
										>
											view in the change feed
										</Link>
									</>
								) : null}
							</>
						)}
					</p>

					<CounterBriefCard counterBrief={counterBrief} locked={counterBriefLocked} />
				</div>
			)}
		</section>
	);
}

/**
 * AI Counter-Brief card. Three states, all honest:
 * - free plan: an upgrade line — the brief is a paid capability.
 * - paid + brief: gap line, three hook directions with grounded rationales,
 *   watch note, and an explicit AI-disclosure line.
 * - paid + null (generation failed validation, timed out, or AI is off):
 *   renders nothing at all — never a placeholder pretending to be insight.
 */
function CounterBriefCard({
	counterBrief,
	locked,
}: {
	counterBrief: CounterBrief | null;
	locked: boolean;
}) {
	if (locked) {
		return (
			<div className="f9-counter-brief is-locked">
				<p className="f9-dossier-subhead">Counter-Brief</p>
				<p className="f9-counter-brief-upgrade">
					Counter-Brief is part of paid plans. Scout unlocks it. Use Upgrade plan above
					to compare options.
				</p>
			</div>
		);
	}
	if (!counterBrief) {
		return null;
	}

	return (
		<div className="f9-counter-brief">
			<p className="f9-dossier-subhead">Counter-Brief</p>
			<p className="f9-counter-brief-gap">{counterBrief.gap}</p>
			<ol className="f9-counter-brief-hooks">
				{counterBrief.hooksToTest.map((hook) => (
					<li key={hook.direction}>
						<span className="f9-counter-brief-direction">{hook.direction}</span>
						<span className="f9-counter-brief-rationale">{hook.rationale}</span>
					</li>
				))}
			</ol>
			<p className="f9-counter-brief-watch">{counterBrief.watchNote}</p>
			<p className="f9-counter-brief-disclosure">
				AI-drafted from observed evidence — verify before briefing.
			</p>
		</div>
	);
}

function formatSharePercent(share: number): string {
	return `${Math.round(share * 100)}%`;
}

/**
 * Ad Aggression Score card: big number, four component bars, a neutral banded
 * interpretation, and a native <details> spelling out the public formula.
 * Null (window under 14 days) renders an honest explanation, never a score.
 */
function AggressionScorecard({ aggression }: { aggression: AggressionScore | null }) {
	if (!aggression) {
		return (
			<p className="f9-dossier-changes">
				Ad Aggression Score unlocks after {MIN_AGGRESSION_WINDOW_DAYS} days of observed
				history — too little evidence for a fair score before that.
			</p>
		);
	}

	const rows = [
		{
			key: "velocity",
			label: "Velocity",
			value: aggression.components.velocity,
			fact: `${aggression.facts.adsPerWeek} new ads/week over ${aggression.facts.windowDays} days`,
		},
		{
			key: "testing",
			label: "Testing",
			value: aggression.components.testing,
			fact: `${formatSharePercent(aggression.facts.testedShare)} of ads run multiple variants`,
		},
		{
			key: "freshness",
			label: "Freshness",
			value: aggression.components.freshness,
			fact: `${formatSharePercent(aggression.facts.freshShare)} of active ads first observed within 30 days`,
		},
		{
			key: "persistence",
			label: "Persistence",
			value: aggression.components.persistence,
			fact: `${formatSharePercent(aggression.facts.persistentShare)} of ads running 30+ days`,
		},
	];

	return (
		<div className="f9-aggression-card">
			<div className="f9-aggression-head">
				<span className="f9-aggression-number">{aggression.score}</span>
				<div>
					<p className="f9-aggression-band">
						{aggression.band.label} · Ad Aggression Score
					</p>
					<p className="f9-aggression-read">{aggression.band.interpretation}</p>
				</div>
			</div>
			<div className="f9-aggression-bars">
				{rows.map((row) => (
					<div className="f9-aggression-bar-row" key={row.key}>
						<span className="f9-aggression-bar-label">{row.label}</span>
						<span aria-hidden="true" className="f9-aggression-bar-track">
							<span
								className={`f9-aggression-bar-fill ${meterWidthClass((row.value / 25) * 100)}`}
							/>
						</span>
						<span className="f9-aggression-bar-value">{row.value}/25</span>
					</div>
				))}
			</div>
			<details className="f9-aggression-details">
				<summary>How this is computed</summary>
				<ul>
					{rows.map((row) => (
						<li key={row.key}>
							<strong>
								{row.label} {row.value}/25
							</strong>{" "}
							— {row.fact}
						</li>
					))}
				</ul>
				<p>
					The four components sum to the score (formula v{aggression.formulaVersion}, public
					by design). Computed from {aggression.facts.adCount} observed ad
					{aggression.facts.adCount === 1 ? "" : "s"} — no model, no hidden weighting.
				</p>
			</details>
		</div>
	);
}

/**
 * Compact angle-mix row: confident angles as count chips, low-confidence
 * fallback reads as a quieter tentative chip, and an honest "N unclassified"
 * note for ads the classifier declined — coverage is never overstated.
 */
function AngleMixRow({ angleMix }: { angleMix: DossierAngleMix }) {
	const hasSignal = angleMix.shares.length > 0 || angleMix.tentativeCount > 0;

	return (
		<div className="f9-dossier-angles">
			{hasSignal ? (
				<>
					{angleMix.shares.map((share) => (
						<Pill variant="angle" key={share.angle}>
							{ANGLE_DISPLAY[share.angle].label} ×{share.count}
						</Pill>
					))}
					{angleMix.tentativeCount > 0 ? (
						<Pill variant="angle" state="tentative">
							{angleMix.tentativeCount} tentative
						</Pill>
					) : null}
				</>
			) : (
				<span className="f9-wk-dim">No confident angle reads yet.</span>
			)}
			{angleMix.unclassifiedCount > 0 ? (
				<span className="f9-dossier-angle-note">
					{angleMix.unclassifiedCount} unclassified
				</span>
			) : null}
		</div>
	);
}

function LongevityLeaderCard({ leader }: { leader: DossierAdHistoryEntry }) {
	return (
		<article className="f9-dossier-leader">
			<div className="f9-dossier-leader-meta">
				<span className="f9-dossier-leader-days">{leader.longevityLabel}</span>
				<Pill state={leader.active ? "healthy" : undefined}>
					{leader.active ? "Active" : "Inactive"}
				</Pill>
			</div>
			<p className="f9-dossier-leader-hook">{leader.hook}</p>
		</article>
	);
}

function VelocityBars({ velocity }: { velocity: DossierVelocity }) {
	const buckets = velocity.buckets;
	const slot = 240 / Math.max(1, buckets.length);
	const max = Math.max(1, velocity.maxCount);

	return (
		<>
			<svg
				aria-label={`New ads observed per week over the trailing ${buckets.length} weeks; busiest week had ${velocity.maxCount}.`}
				className="f9-trend-chart"
				role="img"
				viewBox="0 0 240 60"
			>
				<rect className="f9-trend-baseline" height="1" width="240" x="0" y="56" />
				{buckets.map((bucket, index) => {
					const barHeight = bucket.count > 0 ? Math.max(3, (bucket.count / max) * 52) : 0;
					return (
						<rect
							className={`f9-trend-bar${bucket.count > 0 ? " is-accent" : ""}`}
							height={bucket.count > 0 ? barHeight : 1.5}
							key={bucket.weekStart}
							rx="1"
							width={Math.max(2, slot - 6)}
							x={index * slot + 3}
							y={bucket.count > 0 ? 55 - barHeight : 53.5}
						/>
					);
				})}
			</svg>
			<div className="f9-trend-axis" aria-hidden="true">
				<span>{buckets[0]?.label}</span>
				<span>{buckets[buckets.length - 1]?.label}</span>
			</div>
		</>
	);
}
