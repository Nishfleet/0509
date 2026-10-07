export function SkipLink() {
  return (
    <a
      href="#app-content"
      className="sr-only focus:not-sr-only focus:absolute focus:inset-x-0 focus:top-0 focus:z-20 focus:flex focus:min-h-11 focus:items-center focus:bg-card focus:px-4 focus:text-ink focus:outline-2 focus:outline-ink"
    >
      Skip to content
    </a>
  );
}
