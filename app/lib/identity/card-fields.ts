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

export const NAME_MAX = 120;

export const ABOUT_MAX = 500;

export const DRAFT_FIELDS = ["name", "description"] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

export interface CardDraft {
  name?: string;
  description?: string;
}

export function editedFields(draft: CardDraft): DraftField[] {
  return DRAFT_FIELDS.filter((field) => draft[field] !== undefined);
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

export function overLimitField(name: unknown, description: unknown): "name" | "about" | null {
  if (typeof name === "string" && name.trim().length > NAME_MAX) return "name";
  if (typeof description === "string" && description.trim().length > ABOUT_MAX) return "about";
  return null;
}

export function isDraftSave(formData: FormData | undefined): boolean {
  return formData?.get("intent") === "draft";
}
