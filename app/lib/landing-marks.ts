import { daysAgoLabel } from "./delivery-alert";
import { httpUrl } from "./http-url";

const MAX_MARKS = 3;

type LandingShot = { src: string; capturedAt: string } | { missing: string };

export interface LandingMarkInput {
  id: string;
  isSelf: boolean;
  url: string;
  capturedAt: string;
  headline: string;
  removed: string | null;
  added: string | null;
  before: LandingShot;
  after: LandingShot;
}

export interface LandingMark {
  id: string;
  before: string;
  after: string;
  sourceUrl: string;
  capturedAt: string;
  age: string;
  headline: string;
  ownSite: boolean;
  beforeShot: LandingShot;
  afterShot: LandingShot;
}

function text(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isPair(change: LandingMarkInput): boolean {
  const removed = text(change.removed);
  const added = text(change.added);
  if (removed === null || added === null) return false;
  if (httpUrl(change.url) === null) return false;
  return !Number.isNaN(Date.parse(change.capturedAt.trim()));
}

export function pickLandingMarks(changes: readonly LandingMarkInput[]): LandingMarkInput[] {
  const paired = changes.filter(isPair);
  const own = paired.find((change) => change.isSelf);
  const rest = paired.filter((change) => change.id !== own?.id);
  return (own === undefined ? rest : [own, ...rest]).slice(0, MAX_MARKS);
}

function publicShot(id: string, side: "before" | "after", shot: LandingShot): LandingShot {
  if (!("src" in shot)) return shot;
  return {
    src: `/design/landing/changes/${encodeURIComponent(id)}/${side}`,
    capturedAt: shot.capturedAt,
  };
}

export function landingMarksFromChanges(changes: readonly LandingMarkInput[], now: Date): LandingMark[] {
  return pickLandingMarks(changes).flatMap((change) => {
    const removed = text(change.removed);
    const added = text(change.added);
    if (removed === null || added === null) return [];
    return [
      {
        id: change.id,
        before: removed,
        after: added,
        sourceUrl: change.url.trim(),
        capturedAt: change.capturedAt.trim(),
        age: daysAgoLabel(change.capturedAt, now),
        headline: change.headline,
        ownSite: change.isSelf,
        beforeShot: publicShot(change.id, "before", change.before),
        afterShot: publicShot(change.id, "after", change.after),
      },
    ];
  });
}
