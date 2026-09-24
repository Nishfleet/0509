interface LegalEntry {
  readonly term: string;
  readonly details: readonly string[];
}

export interface LegalSection {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly list?: readonly string[];
  readonly entries?: readonly LegalEntry[];
  readonly closing?: readonly string[];
  readonly link?: { readonly href: string; readonly label: string };
}

export interface LegalDocument {
  readonly path: "/privacy" | "/terms";
  readonly title: string;
  readonly description: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

export const LEGAL_UPDATED = "2026-09-24";
export const OPERATOR = "Five to Nine";
export const GOVERNING_LAW = "India";
export const ACCOUNT_DELETION_DAYS = 30;
export const PRICE_NOTICE_DAYS = 30;
export const LIABILITY_CAP_MONTHS = 12;
export const MINIMUM_AGE = 18;
