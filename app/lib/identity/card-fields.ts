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
