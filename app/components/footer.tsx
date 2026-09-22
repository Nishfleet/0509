const SUPPORT_ADDRESS = "support@0509.io";

export function Footer() {
  return (
    <footer className="border-line text-ink-faint mt-14 border-t pt-7 font-mono text-[0.72rem] tracking-[0.06em]">
      <a
        className="hover:text-ink underline decoration-1 underline-offset-4 transition-colors duration-150"
        href={`mailto:${SUPPORT_ADDRESS}`}
      >
        {SUPPORT_ADDRESS}
      </a>
    </footer>
  );
}
