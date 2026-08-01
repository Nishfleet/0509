import type { ReactNode } from "react";

/**
 * BL-030 — the in-app feedback surface (Component & Motion DNA §4).
 *
 * One place, one voice. Feedback arrives as a single ink-filled strip in the
 * content column — never top-right, never over the page title, never a
 * floating card deck. Ink because ink means *the machine is talking*.
 *
 * It holds at most two lines plus one text action, and it arrives on Land
 * (340ms, the only overshoot in the system) because it is the moment
 * something completed. Two notifications never stack: the newer one replaces
 * the older, which is why callers pass a single resolved message rather than
 * a queue.
 */
export function FeedbackStrip({
  label,
  children,
  actions,
  tone = "ok",
}: {
  /** The mono micro-label. Two words at most. */
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: "ok" | "bad";
}) {
  return (
    <div
      aria-atomic="true"
      aria-live={tone === "bad" ? "assertive" : "polite"}
      className={`f9-wk-strip${tone === "bad" ? " is-bad" : ""}`}
      role={tone === "bad" ? "alert" : "status"}
    >
      <div className="f9-wk-strip-body">
        <span className="f9-wk-strip-label">{label}</span>
        <p>{children}</p>
      </div>
      {actions ? <div className="f9-wk-strip-actions">{actions}</div> : null}
    </div>
  );
}
