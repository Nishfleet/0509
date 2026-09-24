import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

export const TYPE_SCALE = [
  "display-1",
  "display-2",
  "display-3",
  "mark-lg",
  "mark-md",
  "mark-sm",
  "title",
  "row-name",
  "body",
  "body-sm",
  "eyebrow",
  "pill",
  "meta",
] as const;

const twMerge = extendTailwindMerge({ extend: { theme: { text: [...TYPE_SCALE] } } });

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
