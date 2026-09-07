import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { SubmitButton } from "~/components/submit-button";

export interface ConfirmSubmitButtonProps {
	children: ReactNode;
	/** Label shown while armed, e.g. "Confirm — delete collection?" */
	confirmLabel: string;
	/** Auto-disarm window in milliseconds. */
	confirmTimeoutMs?: number;
	/**
	 * Visual weight of the armed state, proportional to irreversibility:
	 * "danger" fills the button red; "light" keeps a red-outline treatment
	 * (sessions and other easily recoverable actions).
	 */
	variant?: "danger" | "light";
	/**
	 * Test/static-render hook: start in the armed state. Never set this in
	 * product code — the two-step flow is the whole point.
	 */
	initiallyArmed?: boolean;
	intent?: string;
	match?: Record<string, string>;
	pendingLabel?: string;
	className?: string;
	disabled?: boolean;
	name?: string;
	value?: string;
}

export function armedConfirmClassName(variant: "danger" | "light") {
	return variant === "danger"
		? "f9-danger-button is-filled f9-confirm-armed"
		: "f9-danger-button f9-confirm-armed";
}

/**
 * Two-step destructive submit. First activation arms the button (swaps the
 * label to `confirmLabel` with danger styling); the second activation lets the
 * real form submission proceed, so the submitter's name/value semantics and
 * SubmitButton's pending matching keep working. Blur, Escape, or a timeout
 * disarms. Without JavaScript this degrades to a plain single-click submit.
 *
 * Accepted degradation (W2-C, 2026-07-25): the no-JS path loses only the
 * confirm affordance, not the action. A disabled-until-hydration guard was
 * considered and rejected — it would remove the destructive action entirely for
 * no-JS users, which is worse than losing the confirm step. The confirm is a
 * progressive enhancement; every destructive action remains server-guarded
 * (auth, ownership, and stale-write checks) regardless of this button.
 */
export function ConfirmSubmitButton({
	children,
	confirmLabel,
	confirmTimeoutMs = 5000,
	variant = "danger",
	initiallyArmed = false,
	className,
	...rest
}: ConfirmSubmitButtonProps) {
	const [armed, setArmed] = useState(initiallyArmed);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimer = () => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	};

	useEffect(() => clearTimer, []);

	const disarm = () => {
		clearTimer();
		setArmed(false);
	};

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		if (armed) {
			// Let the real submit proceed with the submitter intact; reset the
			// armed state so the button reads normally after the action settles.
			disarm();
			return;
		}
		event.preventDefault();
		setArmed(true);
		clearTimer();
		timerRef.current = setTimeout(() => setArmed(false), confirmTimeoutMs);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (armed && event.key === "Escape") {
			event.preventDefault();
			disarm();
		}
	};

	return (
		<>
			<SubmitButton
				{...rest}
				className={armed ? armedConfirmClassName(variant) : className}
				onClick={handleClick}
				onBlur={armed ? disarm : undefined}
				onKeyDown={handleKeyDown}
			>
				{armed ? confirmLabel : children}
			</SubmitButton>
			<span aria-atomic="true" aria-live="polite" className="f9-sr-only">
				{armed ? `${confirmLabel} Activate again to confirm, or press Escape to cancel.` : ""}
			</span>
		</>
	);
}
