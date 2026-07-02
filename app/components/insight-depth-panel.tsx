import type { InsightDepthSummary, InsightTimelineItem } from "~/lib/insight-depth";
import { LocalTime } from "~/components/local-time";

export function InsightDepthPanel({ summary }: { summary: InsightDepthSummary }) {
  return (
    <section className="f9-work-list is-compact" aria-label="Insight depth">
      <div>
        <span className="f9-app-kicker">Insight depth</span>
        <h3 style={{ marginTop: 0 }}>What is working and why</h3>
      </div>
      <div className="f9-dashboard-grid">
        <InsightList
          title="Top hooks"
          items={summary.topHooks.map((item) => ({
            label: item.label,
            detail: item.count > 0 ? `${item.count} signal${item.count === 1 ? "" : "s"} · ${item.detail}` : item.detail,
          }))}
        />
        <InsightList
          title="Media mix"
          items={summary.mediaMix.map((item) => ({
            label: item.label,
            detail: item.count > 0 ? `${item.count} signal${item.count === 1 ? "" : "s"} · ${item.detail}` : item.detail,
          }))}
        />
        <InsightList
          title="Observed campaign duration"
          items={summary.campaignDurations.map((item) => ({
            label: item.label,
            detail: item.count > 0 ? `${item.count} signal${item.count === 1 ? "" : "s"} · ${item.detail}` : item.detail,
          }))}
        />
        <InsightList
          title="Metric evidence"
          items={summary.metricProof.map((item) => ({
            label: item.label,
            detail: item.count > 0 ? `${item.count} signal${item.count === 1 ? "" : "s"} · ${item.detail}` : item.detail,
          }))}
        />
      </div>
      <div className="f9-dashboard-grid">
        <InsightTimeline title="Creative timeline" items={summary.creativeTimeline} />
        <InsightTimeline title="Landing-page history" items={summary.landingPageHistory} />
      </div>
    </section>
  );
}

function InsightList({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; detail: string }>;
}) {
  return (
    <article className="f9-app-panel">
      <p className="f9-app-kicker">{title}</p>
      <div className="f9-work-list is-compact">
        {items.map((item) => (
          <div className="f9-work-row" key={`${title}:${item.label}`}>
            <div>
              <h4 style={{ marginBottom: "0.25rem" }}>{item.label}</h4>
              <p className="f9-muted-copy">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function InsightTimeline({
  title,
  items,
}: {
  title: string;
  items: InsightTimelineItem[];
}) {
  return (
    <article className="f9-app-panel">
      <p className="f9-app-kicker">{title}</p>
      <div className="f9-work-list is-compact">
        {items.length > 0 ? (
          items.map((item) => (
            <div className="f9-work-row" key={`${title}:${item.label}:${item.timestamp}`}>
              <div>
                <h4 style={{ marginBottom: "0.25rem" }}>{item.label}</h4>
                <p className="f9-muted-copy">{item.detail}</p>
                <p className="f9-muted-copy">
                  <LocalTime iso={item.timestamp} mode="date" />
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="f9-muted-copy">No evidence yet.</p>
        )}
      </div>
    </article>
  );
}
