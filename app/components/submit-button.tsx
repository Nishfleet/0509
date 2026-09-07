import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useNavigation } from "react-router";

interface SubmitButtonProps {
  children: ReactNode;
  /**
   * Matches the form's hidden `intent` field so only the submitted form's
   * button goes pending on pages with many forms. Omit on single-form pages.
   */
  intent?: string;
  /**
   * Extra formData fields to discriminate between repeated forms with the
   * same intent (e.g. one refresh form per watchlist row).
   */
  match?: Record<string, string>;
  /**
   * For GET forms (search), where submissions navigate without formData:
   * pending while a navigation to this pathname is loading.
   */
  getAction?: string;
  /**
   * Forces the in-flight state from outside. A fetcher submission never enters
   * `useNavigation()`, so a caller using `useFetcher` must pass its own
   * `fetcher.state !== "idle"` here or the button would never show pending.
   * Omitted (the default) keeps the navigation-derived behaviour unchanged.
   */
  pending?: boolean;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
	/** Passthroughs so wrappers (ConfirmSubmitButton) can intercept clicks. */
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	onBlur?: (event: FocusEvent<HTMLButtonElement>) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function SubmitButton(props: SubmitButtonProps) {
  const navigation = useNavigation();
  const formData = navigation.state === "idle" ? null : navigation.formData;
  const intentMatches =
    props.intent === undefined || formData?.get("intent") === props.intent;
  // A button submitting name/value lands in formData too, so `match` can
  // discriminate on the submitter as well as hidden fields.
  const matchMatches = Object.entries(props.match ?? {}).every(
    ([field, expected]) => formData?.get(field) === expected,
  );
  const navigationPending = props.getAction
    ? navigation.state === "loading" &&
      navigation.location?.pathname === props.getAction
    : Boolean(formData) && intentMatches && matchMatches;
  const pending = props.pending ?? navigationPending;

  return (
    <button
      className={props.className}
      type="submit"
      name={props.name}
      value={props.value}
      disabled={props.disabled || pending}
      aria-busy={pending || undefined}
			onClick={props.onClick}
			onBlur={props.onBlur}
			onKeyDown={props.onKeyDown}
    >
      {pending ? (
        <>
          <span className="f9-button-spinner" aria-hidden="true" />
          {props.pendingLabel ?? props.children}
        </>
      ) : (
        props.children
      )}
    </button>
  );
}
