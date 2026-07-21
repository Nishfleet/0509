import { Fragment } from "react";

/**
 * WP-C2 — the forward-only first-run spine (Direction A's mechanic under the
 * Wire register). Three fixed nodes, left→right, order never changes:
 *   Add a competitor → First scan → First brief
 *
 * Render is a pure function of `furthest` (see `firstRunSpineNodeStatuses`).
 * `furthest` itself is derived server-side from durable, monotonic facts so the
 * rail can only advance — never resets — during the onboarding window. A
 * completed scan is NOT a brief: it advances node 2 to done and leaves node 3
 * pending ("filing") until a real brief/digest record exists. Once the brief
 * has filed the spine retires (callers stop rendering it).
 */

export type FirstRunMilestone = "add" | "scan" | "filing" | "brief";
export type FirstRunNodeStatus = "done" | "now" | "idle";
export type FirstRunTrackFill = "solid" | "gradient" | "idle";
export type FirstRunScanPhase = "queued" | "reading";

interface SpineNodeDef {
  key: "add" | "scan" | "brief";
  label: string;
  sub: string;
}

const SPINE_NODES: SpineNodeDef[] = [
  { key: "add", label: "Add a competitor", sub: "Paste a website" },
  { key: "scan", label: "First scan", sub: "We read their ads + page" },
  { key: "brief", label: "First brief", sub: "Filed to your inbox" },
];

const NODE_STATUSES: Record<FirstRunMilestone, FirstRunNodeStatus[]> = {
  add: ["now", "idle", "idle"],
  scan: ["done", "now", "idle"],
  filing: ["done", "done", "now"],
  brief: ["done", "done", "done"],
};

/**
 * Durable, monotonic derivation of the furthest milestone reached. Every input
 * is monotonic during onboarding (a competitor once added stays added; a scan
 * once complete stays complete; a brief once filed stays filed), so the
 * returned milestone can only move forward. A completed scan alone never
 * reaches "brief" — only a real brief/digest record does.
 */
export function resolveFirstRunFurthest(input: {
  hasCompetitor: boolean;
  firstScanComplete: boolean;
  hasAnyBrief: boolean;
}): FirstRunMilestone {
  if (input.hasAnyBrief) return "brief";
  if (input.hasCompetitor && input.firstScanComplete) return "filing";
  if (input.hasCompetitor) return "scan";
  return "add";
}

/**
 * The spine renders only during the first-run window — from an empty workspace
 * until the first brief has actually been filed. It stays visible through the
 * "filing" gap (scan done, brief pending); a completed scan does not retire it.
 */
export function shouldRenderFirstRunSpine(input: { hasAnyBrief: boolean }): boolean {
  return !input.hasAnyBrief;
}

/** Node statuses `[add, scan, brief]` — a pure function of `furthest`. */
export function firstRunSpineNodeStatuses(
  furthest: FirstRunMilestone,
): FirstRunNodeStatus[] {
  return NODE_STATUSES[furthest];
}

/** Connector fills between adjacent nodes — a pure function of `furthest`. */
export function firstRunSpineTrackFills(
  furthest: FirstRunMilestone,
): FirstRunTrackFill[] {
  const statuses = firstRunSpineNodeStatuses(furthest);
  const fills: FirstRunTrackFill[] = [];
  for (let index = 0; index < statuses.length - 1; index += 1) {
    const left = statuses[index];
    const right = statuses[index + 1];
    if (left === "done" && right === "done") {
      fills.push("solid");
    } else if (left === "done" && right === "now") {
      fills.push("gradient");
    } else {
      fills.push("idle");
    }
  }
  return fills;
}

function nodeSub(
  node: SpineNodeDef,
  status: FirstRunNodeStatus,
  scanDomain?: string,
  scanPhase?: FirstRunScanPhase,
) {
  if (node.key === "scan" && status === "now") {
    // "Reading now" is only truthful for a running scan; a queued scan says so.
    if (scanPhase === "reading" && scanDomain) return `Reading ${scanDomain} now`;
    if (scanPhase === "queued") return "Queued — next in line";
    return node.sub;
  }
  return node.sub;
}

function currentMilestoneIndex(furthest: FirstRunMilestone) {
  if (furthest === "add") return 0;
  if (furthest === "scan") return 1;
  return 2; // filing + brief both center on the First brief node
}

function progressFor(furthest: FirstRunMilestone) {
  switch (furthest) {
    case "add":
      return 33;
    case "scan":
      return 66;
    case "filing":
      return 90;
    default:
      return 100;
  }
}

function SpineCheck() {
  return (
    <svg
      aria-hidden="true"
      className="f9-spine-check"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.25"
      viewBox="0 0 16 16"
      width="12"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export function FirstRunSpine({
  furthest,
  scanDomain,
  scanPhase,
  variant = "full",
}: {
  furthest: FirstRunMilestone;
  scanDomain?: string;
  scanPhase?: FirstRunScanPhase;
  variant?: "full" | "compact";
}) {
  const statuses = firstRunSpineNodeStatuses(furthest);
  const tracks = firstRunSpineTrackFills(furthest);
  const currentIndex = currentMilestoneIndex(furthest);
  const currentNode = SPINE_NODES[currentIndex];
  const step = currentIndex + 1;
  const progress = progressFor(furthest);

  return (
    <nav
      aria-label="First brief progress"
      className="f9-first-run-spine"
      data-variant={variant}
    >
      <ol className="f9-spine-rail">
        {SPINE_NODES.map((node, index) => (
          <Fragment key={node.key}>
            {index > 0 ? (
              <li
                aria-hidden="true"
                className="f9-spine-track"
                data-fill={tracks[index - 1]}
              />
            ) : null}
            <li className="f9-spine-node" data-status={statuses[index]}>
              <span className="f9-spine-node-dot" aria-hidden="true">
                {statuses[index] === "done" ? <SpineCheck /> : <span>{index + 1}</span>}
              </span>
              <span className="f9-spine-node-body">
                <span className="f9-spine-node-label">{node.label}</span>
                <span className="f9-spine-node-sub">
                  {nodeSub(node, statuses[index], scanDomain, scanPhase)}
                </span>
              </span>
            </li>
          </Fragment>
        ))}
      </ol>
      <p className="f9-first-run-spine-pill">
        <span className="f9-spine-pill-label">
          Step {step} of 3 · {currentNode.label}
        </span>
        <span className="f9-spine-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      </p>
    </nav>
  );
}
