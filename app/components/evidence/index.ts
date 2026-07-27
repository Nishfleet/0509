/**
 * Evidence Desk primitives (BL-005) — the shared vocabulary every Evidence
 * Desk work package builds from. Brief: docs/design/EVIDENCE-DESK-BRIEF.md.
 *
 * The button API of the workspace is `PrimaryAction` / `SecondaryAction` /
 * `TertiaryAction` and nothing else (brief §5). No fourth style ships again.
 */

export {
  resolveActionTarget,
  type ActionTarget,
  type ResolvedActionTarget,
} from "./action-target";

export {
  PrimaryAction,
  SecondaryAction,
  TertiaryAction,
  type EvidenceActionProps,
  type EvidenceActionRank,
} from "./cta";

export {
  CaptureStrip,
  buildCaptureWindow,
  trailingQuietRun,
  CAPTURE_QUIET_RUN_THRESHOLD,
  CAPTURE_STRIP_GAP_LEGEND,
  CAPTURE_STRIP_LEGEND_BASE,
  CAPTURE_WINDOW_DAYS,
  type CaptureDay,
  type CaptureDayState,
} from "./capture-strip";

export {
  DiffPlate,
  hasCaptureTime,
  DIFF_PLATE_DEGRADE_COPY,
  STORED_CAPTURE_NOTE,
  type DiffCapture,
  type DiffPlateExtraChange,
} from "./diff-plate";

export {
  EvidencePlate,
  formatPlateNumber,
  MISSING_CAPTURE_TIME_LABEL,
  UNREADABLE_CAPTURE_COPY,
} from "./evidence-plate";

export {
  FactRail,
  FactRailRow,
  isMissingFactValue,
  DEFAULT_MISSING_VALUE,
  FACT_RAIL_MAX_ROWS,
  type FactRow,
} from "./fact-rail";

export {
  QuietLine,
  QuietLineList,
  QUIET_LINE_VISIBLE_LIMIT,
  type QuietLineItem,
} from "./quiet-line";

export {
  SpecimenEmptyState,
  RESERVED_SLOT_COPY,
  RESERVED_SLOT_LABEL,
  type SpecimenAction,
} from "./specimen-empty-state";

export {
  StatusStrip,
  STATUS_STRIP_MAX_CELLS,
  type StatusCell,
  type StatusStripAction,
} from "./status-strip";
