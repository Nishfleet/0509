export const SUPPORT_ADDRESS = "support@0509.io";

const linkClass =
  "text-ink-soft hover:text-ink underline decoration-1 underline-offset-4 transition-colors duration-150";

const footerLinkClass = `${linkClass} inline-flex min-h-11 items-center`;

export function SupportLink({ className = linkClass }: { className?: string }) {
  return (
    <a className={className} href={`mailto:${SUPPORT_ADDRESS}`}>
      {SUPPORT_ADDRESS}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="mt-14 flex flex-wrap gap-x-6 border-t border-line pt-7 font-mono text-[0.72rem] tracking-[0.06em]">
      <SupportLink className={footerLinkClass} />
      <a className={footerLinkClass} href="/privacy">
        Privacy
      </a>
      <a className={footerLinkClass} href="/terms">
        Terms
      </a>
    </footer>
  );
}
