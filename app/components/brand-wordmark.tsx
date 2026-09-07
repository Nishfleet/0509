type BrandWordmarkProps = {
  meta?: string;
};

export function BrandWordmark({ meta }: BrandWordmarkProps) {
  return (
    <span className="f9-brand-wordmark-shell">
      <span className="f9-wordmark" aria-hidden="true">
        <span>five</span>
        <span className="f9-wordmark-bridge">to</span>
        <span>nine</span>
      </span>
      <span className="f9-sr-only">Five to Nine</span>
      {meta ? <small>{meta}</small> : null}
    </span>
  );
}
