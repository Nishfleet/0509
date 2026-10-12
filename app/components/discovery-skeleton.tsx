export function DiscoverySkeleton() {
  return (
    <ul aria-hidden="true" data-testid="discovery-skeleton" className="mt-8 border-b border-line">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-start gap-3 border-t border-line py-4">
          <span className="size-8 shrink-0 border border-line bg-card" />
          <div className="min-w-0 flex-1">
            <span className="block h-4 w-2/5 bg-line" />
            <span className="mt-2 block h-3 w-1/4 bg-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}
