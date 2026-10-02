import { Link } from "react-router";

import { SUPPORT_ADDRESS } from "./footer";
import { SIGN_IN_LEDE, SIGN_IN_TITLE } from "./sign-in-sent";

interface DeleteProgress {
  files: "removing" | "removed" | "failed";
  deleted: number | null;
}

export function AccountDeleteNotice({ id, progress }: { id: string; progress: DeleteProgress }) {
  const files =
    progress.files === "removing"
      ? "Saved page copies and screenshots: still removing"
      : progress.files === "failed"
        ? `Saved page copies and screenshots: stopped. Write to ${SUPPORT_ADDRESS} and we'll finish it.`
        : progress.deleted === null
          ? "Saved page copies and screenshots: removed"
          : `Saved page copies and screenshots: removed (${String(progress.deleted)} files)`;
  return (
    <section data-delete="progress" aria-live="polite">
      <h2 className={SIGN_IN_TITLE}>Your account is deleted</h2>
      <ul className={SIGN_IN_LEDE}>
        <li>Brands, everything we found, briefs, send history, share image, API keys and connected apps: removed</li>
        <li>{files}</li>
      </ul>
      {progress.files === "removing" ? (
        <Link
          to={`/login?deleted=${encodeURIComponent(id)}`}
          className={`${SIGN_IN_LEDE} inline-flex min-h-11 items-center underline decoration-1 underline-offset-4`}
        >
          Check again
        </Link>
      ) : null}
    </section>
  );
}
