export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="fixed top-0 left-0 z-50 flex min-h-11 -translate-y-full items-center bg-card px-4 text-ink focus:translate-y-0 focus:outline-2 focus:outline-ink"
    >
      Skip to content
    </a>
  );
}
