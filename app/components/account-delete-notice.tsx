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
      ? "Snapshots and screenshots: still removing"
      : progress.files === "failed"
        ? `Snapshots and screenshots: stopped. Write to ${SUPPORT_ADDRESS} and we'll finish it.`
        : progress.deleted === null
          ? "Snapshots and screenshots: removed"
          : `Snapshots and screenshots: removed (${String(progress.deleted)} files)`;
  return (
    <section data-delete="progress" aria-live="polite">
      <h2 className={SIGN_IN_TITLE}>Your account is deleted</h2>
      <ul className={SIGN_IN_LEDE}>
        <li>Brands, signals, briefs, send history, card, API keys and connected apps: removed</li>
        <li>{files}</li>
      </ul>
      {progress.files === "removing" ? (
        <Link to={`/login?deleted=${encodeURIComponent(id)}`} className={SIGN_IN_LEDE}>
          Check again
        </Link>
      ) : null}
    </section>
  );
}
