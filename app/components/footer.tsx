const TAKEDOWN_ADDRESS = "support@0509.io";

const linkClass =
  "text-ink-soft hover:text-ink underline decoration-1 underline-offset-4 transition-colors duration-150";

export function Footer() {
  return (
    <footer className="border-line text-ink-soft mt-14 border-t pt-7 font-mono text-[0.72rem] tracking-[0.06em]">
      <a className={linkClass} href="/privacy">
        Privacy
      </a>
      <span aria-hidden="true"> · </span>
      <a className={linkClass} href="/terms">
        Terms
      </a>
      <span aria-hidden="true"> · </span>
      <a className={linkClass} href={`mailto:${TAKEDOWN_ADDRESS}`}>
        {TAKEDOWN_ADDRESS}
      </a>
    </footer>
  );
}
