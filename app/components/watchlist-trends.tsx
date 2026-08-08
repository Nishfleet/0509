import { meterWidthClass } from "~/lib/meter-width";
import {
	buildLaunchTimeline,
	buildLongevityLeaderboard,
	buildScanActivitySeries,
	type CreativeWallItem,
	type LaunchTimeline,
	type LongevityLeaderboard,
	type ScanActivitySeries,
	type WatchlistDailyActivity,
} from "~/lib/trend-chart-data";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";

/**
 * Three compact trend cards for a watchlist, Cloudflare-analytics style:
 * label + headline number + small viz. No chart library — proportional divs
 * and inline SVG bars only. Every card renders an honest sparse sentence
 * instead of a near-empty chart when there is not enough real data.
 */
export function WatchlistTrends({
	items,
	dailyActivity,
	plan,
}: {
	items: CreativeWallItem[];
	dailyActivity: WatchlistDailyActivity[];
	plan: string;
}) {
	const timeline = buildLaunchTimeline(items);
	const leaderboard = buildLongevityLeaderboard(items);
	const activity = buildScanActivitySeries(dailyActivity);

	return (
		<section aria-label="Watchlist trends">
			<div className="f9-panel-toolbar">
				<div>
					<p className="f9-wk-kick">Trends</p>
					<h3 className="f9-trend-heading">How this competitor is moving</h3>
				</div>
			</div>
			<div className="f9-trend-grid">
				<LaunchTimelineCard timeline={timeline} hasAds={items.length > 0} plan={plan} />
				<LongevityLeaderboardCard leaderboard={leaderboard} plan={plan} />
				<ScanActivityCard activity={activity} plan={plan} />
			</div>
		</section>
	);
}

function sparseScanCopy(plan: string) {
	return plan === "free"
		? "The free plan takes one snapshot when a competitor is added — paid plans check every 3–6 hours, and each scan adds to this chart."
		: "Not enough scans yet — this fills in as scheduled checks accumulate over the next few days.";
}

function LaunchTimelineCard({
	timeline,
	hasAds,
	plan,
}: {
	timeline: LaunchTimeline;
	hasAds: boolean;
	plan: string;
}) {
	return (
		<article className="f9-trend-card">
			<p className="f9-trend-label">Launch timeline</p>
			<p className="f9-trend-value">
				{timeline.datedAdCount}
				<span className="f9-trend-unit"> dated ads</span>
			</p>
			{timeline.sparse ? (
				<p className="f9-trend-sparse">
					{hasAds
						? "Meta has published start dates for fewer than two of these ads, so there is no timeline to chart yet."
						: sparseScanCopy(plan)}
				</p>
			) : (
				<>
					<TimelineBars timeline={timeline} />
					<div className="f9-trend-axis" aria-hidden="true">
						<span>{timeline.buckets[0]?.label}</span>
						<span>{timeline.buckets[timeline.buckets.length - 1]?.label}</span>
					</div>
				</>
			)}
			<p className="f9-trend-note">
				Ads by launch week{timeline.earlierCount > 0 ? ` · +${timeline.earlierCount} started earlier` : ""}
				{timeline.undatedAdCount > 0 ? ` · ${timeline.undatedAdCount} undated` : ""} — start dates
				per Meta Ad Library.
			</p>
		</article>
	);
}

function TimelineBars({ timeline }: { timeline: LaunchTimeline }) {
	const buckets = timeline.buckets;
	const slot = 240 / buckets.length;
	const max = Math.max(1, timeline.maxCount);

	return (
		<svg
			aria-label={`Ad launches per week over the last ${buckets.length} weeks; busiest week had ${timeline.maxCount}.`}
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
						width={Math.max(2, slot - 6)}
						x={index * slot + 3}
						y={bucket.count > 0 ? 55 - barHeight : 53.5}
					/>
				);
			})}
		</svg>
	);
}

function LongevityLeaderboardCard({
	leaderboard,
	plan,
}: {
	leaderboard: LongevityLeaderboard;
	plan: string;
}) {
	return (
		<article className="f9-trend-card">
			<p className="f9-trend-label">Longest on air</p>
			<p className="f9-trend-value">
				{leaderboard.entries[0]?.days ?? 0}
				<span className="f9-trend-unit"> days</span>
			</p>
			{leaderboard.sparse ? (
				<p className="f9-trend-sparse">{sparseScanCopy(plan)}</p>
			) : (
				<ol className="f9-trend-leaderboard">
					{leaderboard.entries.map((entry) => (
						<li className="f9-trend-leader-row" key={entry.adId}>
							<div className="f9-trend-leader-head">
								<span className="f9-trend-leader-name">
									{formatAdvertiserLabel(entry.advertiser)}
								</span>
								<span className="f9-trend-leader-days">{entry.label}</span>
							</div>
							<div className="f9-trend-leader-track">
								<div
									className={`f9-trend-leader-fill${entry.kind === "tracked" ? " is-tracked" : ""} ${meterWidthClass(Math.max(4, (entry.days / Math.max(1, leaderboard.maxDays)) * 100))}`}
								/>
							</div>
						</li>
					))}
				</ol>
			)}
			<p className="f9-trend-note">
				Green bars use Meta&rsquo;s published start date; gray bars count days tracked here.
			</p>
		</article>
	);
}

function ScanActivityCard({ activity, plan }: { activity: ScanActivitySeries; plan: string }) {
	return (
		<article className="f9-trend-card">
			<p className="f9-trend-label">Scan activity · 30 days</p>
			<p className="f9-trend-value">
				{activity.totalEventsConfirmed}
				<span className="f9-trend-unit">
					{" "}
					change{activity.totalEventsConfirmed === 1 ? "" : "s"} confirmed
				</span>
			</p>
			{activity.sparse ? (
				<p className="f9-trend-sparse">{sparseScanCopy(plan)}</p>
			) : (
				<>
					<p className="f9-trend-series-label">Peak ads live per day</p>
					<ActivityStrip
						accent={false}
						ariaLabel={`Peak ads live per day over the last 30 days; highest was ${activity.maxAdsSeenPeak}.`}
						max={activity.maxAdsSeenPeak}
						values={activity.days.map((day) => day.adsSeenPeak)}
					/>
					<p className="f9-trend-series-label">Changes confirmed per day</p>
					<ActivityStrip
						accent
						ariaLabel={`Changes confirmed per day over the last 30 days; ${activity.totalEventsConfirmed} in total.`}
						max={activity.maxEventsConfirmed}
						values={activity.days.map((day) => day.eventsConfirmed)}
					/>
				</>
			)}
			<p className="f9-trend-note">
				From {activity.scannedDayCount} scanned day{activity.scannedDayCount === 1 ? "" : "s"} of
				succeeded checks.
			</p>
		</article>
	);
}

function ActivityStrip({
	values,
	max,
	accent,
	ariaLabel,
}: {
	values: number[];
	max: number;
	accent: boolean;
	ariaLabel: string;
}) {
	const slot = 300 / values.length;
	const safeMax = Math.max(1, max);

	return (
		<svg aria-label={ariaLabel} className="f9-trend-chart" role="img" viewBox="0 0 300 26">
			<rect className="f9-trend-baseline" height="1" width="300" x="0" y="24" />
			{values.map((value, index) => {
				const barHeight = value > 0 ? Math.max(2, (value / safeMax) * 22) : 0;
				return (
					<rect
						className={`f9-trend-bar${accent && value > 0 ? " is-accent" : ""}`}
						height={value > 0 ? barHeight : 1}
						key={index}
						width={Math.max(2, slot - 3)}
						x={index * slot + 1.5}
						y={value > 0 ? 23 - barHeight : 22}
					/>
				);
			})}
		</svg>
	);
}
