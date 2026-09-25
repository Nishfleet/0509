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
