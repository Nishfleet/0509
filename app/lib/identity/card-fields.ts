import type { Subject } from "./normalise";

export type FieldReview = "fill" | "check" | "empty";

export interface CardReview {
  name: FieldReview;
  description: FieldReview;
  socials: FieldReview;
}

export interface SiteFields {
  name: string | null;
  description: string | null;
  socials: { platform: string; url: string }[];
  review: CardReview;
  unfound: boolean;
}

export type CardValues = Pick<SiteFields, "name" | "description" | "socials">;

export type DraftField = "name" | "description";

export interface CardDraft {
  name?: string;
  description?: string;
}

export function editedFields(draft: CardDraft): DraftField[] {
  return (["name", "description"] as const).filter((field) => draft[field] !== undefined);
}

export interface CreatorRows {
  channel: string | null;
  handle: string;
}

const CHANNELS: Record<NonNullable<Subject["platform"]>, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
};

export function creatorRows(subject: Subject): CreatorRows | null {
  if (subject.kind === "domain") return null;
  return {
    channel: subject.platform === undefined ? null : CHANNELS[subject.platform],
    handle: `@${subject.registrable}`,
  };
}
