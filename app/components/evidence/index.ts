/**
 * HISTORICAL: Evidence Desk-era primitives, retained only where the report
 * document and watchlist detail still consume them. The Evidence Desk
 * program is CLOSED; the v4 landing language (f9-wk-*) is the product's one
 * design system, and these exports shrink with every era-wipe package until
 * this barrel is deleted (design-unification ledger, E-items).
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

