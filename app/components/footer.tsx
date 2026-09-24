const SUPPORT_ADDRESS = "support@0509.io";

const linkClass =
  "text-ink-soft hover:text-ink underline decoration-1 underline-offset-4 transition-colors duration-150";

export function SupportLink() {
  return (
    <a className={linkClass} href={`mailto:${SUPPORT_ADDRESS}`}>
      {SUPPORT_ADDRESS}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="border-line mt-14 flex flex-wrap gap-x-6 gap-y-3 border-t pt-7 font-mono text-[0.72rem] tracking-[0.06em]">
      <SupportLink />
      <a className={linkClass} href="/privacy">
        Privacy
      </a>
      <a className={linkClass} href="/terms">
        Terms
      </a>
    </footer>
  );
}
