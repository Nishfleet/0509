import { WorkingHeader } from "~/components/workspace/working-header";

export interface ReportsLockedStateProps {
  /** The report kind revealed by a deep link. Never the gated resource id. */
  context?: string;
  upgradeTo: string;
}

/**
 * The reports-only plan boundary.
 *
 * The old shared LockedFeature rendered a shadow card around a dashed sample
 * report. In the landing language the explanation is the surface: one quiet
 * header, one short reason, and one filled way forward.
 */
export function ReportsLockedState({
  context,
  upgradeTo,
}: ReportsLockedStateProps) {
  return (
    <section
      aria-labelledby="reports-locked-title"
      className="f9-wk-reports-locked f9-locked-feature"
    >
      <WorkingHeader
        action={{ label: "Upgrade to Agency", to: upgradeTo }}
        context="Open client-ready reports and share the evidence with your team — included in the Agency plan."
        title="Client-ready reports"
        titleId="reports-locked-title"
      />
      <div className="f9-wk-sec">
        <p className="f9-wk-kick">Agency reports</p>
        <h2 className="f9-wk-reports-state-title">
          Everything stays private until you choose to send it.
        </h2>
        <p className="f9-wk-reports-state-copy">
          Agency adds in-workspace review, client links, and PDF preparation
          from the evidence you already keep.
          {context ? (
            <>
              {" "}
              <strong>{context}</strong> requested. Its workspace evidence is
              not shown while access is locked.
            </>
          ) : (
            " Your workspace evidence is not used as an upgrade preview."
          )}
        </p>
      </div>
    </section>
  );
}
