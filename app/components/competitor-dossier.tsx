import { Link } from "react-router";

import { LocalTime } from "~/components/local-time";
import type {
	CompetitorDossier,
	DossierAdHistoryEntry,
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
}: {
	dossier: CompetitorDossier;
	watchlistId: string;
}) {
	return (
		<section aria-label="Competitor intelligence">
			<div className="f9-panel-toolbar">
				<div>
					<p className="f9-app-kicker">Intelligence</p>
					<h3 style={{ marginTop: 0 }}>What this history adds up to</h3>
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

					<div>
						<p className="f9-dossier-subhead">Proven runners</p>
						{dossier.longevityLeaders.length === 0 ? (
							<p className="f9-muted-copy">No longevity signal yet.</p>
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
							<p className="f9-muted-copy">
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
				</div>
			)}
		</section>
	);
}

function LongevityLeaderCard({ leader }: { leader: DossierAdHistoryEntry }) {
	return (
		<article className="f9-dossier-leader">
			<div className="f9-dossier-leader-meta">
				<span className="f9-dossier-leader-days">{leader.longevityLabel}</span>
				<span className={`f9-status-pill${leader.active ? " is-healthy" : ""}`}>
					{leader.active ? "Active" : "Inactive"}
				</span>
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
