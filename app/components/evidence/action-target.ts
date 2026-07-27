/**
 * A control that goes nowhere is a dead control, and a dead control on an
 * evidence surface is worse than no control: it implies the product can do
 * something it cannot. Every Evidence Desk action API that wraps a CTA rank
 * therefore takes this union, so the type system refuses an action with no
 * destination and no handler.
 *
 * The CTA ranks themselves (`cta.tsx`) stay looser on purpose — they also
 * serve `type="submit"` controls inside a form, where the form element is
 * the destination.
 */

export type ActionTarget =
  | { to: string; href?: never; onClick?: never }
  | { href: string; to?: never; onClick?: never }
  | { onClick: () => void; to?: never; href?: never };

export interface ResolvedActionTarget {
  to?: string;
  href?: string;
  onClick?: () => void;
}

/** Narrows the union into the props a CTA rank accepts. */
export function resolveActionTarget(target: ActionTarget): ResolvedActionTarget {
  if ("to" in target && target.to !== undefined) return { to: target.to };
  if ("href" in target && target.href !== undefined) return { href: target.href };
  return { onClick: (target as { onClick: () => void }).onClick };
}
