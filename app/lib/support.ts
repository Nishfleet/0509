import {
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_STATUSES,
  type SupportCaseCategory,
  type SupportCasePriority,
  type SupportCaseStatus,
} from "~/lib/types";
import { isSecretishMemoryString } from "~/lib/agent-redaction";

export const SUPPORT_EMAIL = "support@0509.io";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
export const SUPPORT_CASE_SUBJECT_MAX_LENGTH = 160;
export const SUPPORT_CASE_DETAIL_MAX_LENGTH = 4000;

export {
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_STATUSES,
};

export const SUPPORT_CASE_CATEGORY_LABELS: Record<SupportCaseCategory, string> = {
  billing: "Billing, cancellation, or invoice",
  source: "Competitor source or tracking",
  delivery: "Digest or email delivery",
  account: "Login or personal access",
  team: "Team seats or workspace access",
  security: "Security, privacy, or deletion",
  migration: "Setup or migration",
  other: "Other",
};

export const SUPPORT_CASE_PRIORITY_LABELS: Record<SupportCasePriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
};

export const SUPPORT_CASE_STATUS_LABELS: Record<SupportCaseStatus, string> = {
  open: "Open",
  closed: "Closed",
};

export class SupportCaseInputError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SupportCaseInputError";
    this.code = code;
    this.status = status;
  }
}

export function readSupportCaseCategory(value: unknown): SupportCaseCategory | null {
  const normalized = String(value ?? "").trim();
  return SUPPORT_CASE_CATEGORIES.includes(normalized as SupportCaseCategory)
    ? (normalized as SupportCaseCategory)
    : null;
}

export function readSupportCasePriority(value: unknown): SupportCasePriority | null {
  const normalized = String(value ?? "").trim();
  return SUPPORT_CASE_PRIORITIES.includes(normalized as SupportCasePriority)
    ? (normalized as SupportCasePriority)
    : null;
}

export function normalizeSupportCaseInput(input: {
  category: unknown;
  priority?: unknown;
  subject: unknown;
  detail: unknown;
}) {
  const category = readSupportCaseCategory(input.category);
  if (!category) {
    throw new SupportCaseInputError("invalid_support_category", "Choose a valid support category.");
  }

  const priority = readSupportCasePriority(input.priority ?? "normal");
  if (!priority) {
    throw new SupportCaseInputError("invalid_support_priority", "Choose a valid support priority.");
  }

  const subject = normalizeSupportCaseText(input.subject, "subject", SUPPORT_CASE_SUBJECT_MAX_LENGTH);
  const detail = normalizeSupportCaseText(input.detail, "details", SUPPORT_CASE_DETAIL_MAX_LENGTH);

  return {
    category,
    priority,
    subject,
    detail,
  };
}

function normalizeSupportCaseText(value: unknown, fieldName: "subject" | "details", maxLength: number) {
  if (typeof value !== "string") {
    throw new SupportCaseInputError(
      `invalid_support_${fieldName}`,
      fieldName === "subject"
        ? "Add a short subject so we can route this."
        : "Add the details you want support to see.",
    );
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new SupportCaseInputError(
      `missing_support_${fieldName}`,
      fieldName === "subject"
        ? "Add a short subject so we can route this."
        : "Add the details you want support to see.",
    );
  }
  if (normalized.length > maxLength) {
    throw new SupportCaseInputError(
      `support_${fieldName}_too_long`,
      fieldName === "subject"
        ? `Keep the subject under ${maxLength} characters.`
        : `Keep the case details under ${maxLength.toLocaleString("en-GB")} characters.`,
    );
  }
  if (isSecretishMemoryString(normalized) || containsPaymentCardNumber(normalized)) {
    throw new SupportCaseInputError(
      "secret_support_case_rejected",
      "Support cases cannot contain secrets, tokens, webhook URLs, card numbers, or private credentials.",
    );
  }

  return normalized;
}

function containsPaymentCardNumber(value: string) {
  const separators = new Set([" ", "-", ".", ",", "/", "_", "\t", "\n", "\r", "\u00a0", "\u2007", "\u2009", "\u202f"]);
  const candidates: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (!/\d/.test(value[index])) {
      continue;
    }

    let digits = "";
    let cursor = index;
    while (cursor < value.length && (/\d/.test(value[cursor]) || separators.has(value[cursor]))) {
      if (/\d/.test(value[cursor])) {
        digits += value[cursor];
      }
      cursor += 1;
    }
    if (digits.length >= 13 && digits.length <= 19) {
      candidates.push(digits);
    }
  }

  return candidates.some((digits) => {
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
}

function passesLuhn(digits: string) {
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum > 0 && sum % 10 === 0;
}
