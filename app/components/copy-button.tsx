import { useEffect, useId, useState } from "react";

export function CopyButton(props: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyErrorId = `copy-button-error-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyToClipboard() {
    setCopied(false);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
    } catch {
      setCopyError("Could not copy. Try again.");
    }
  }

  return (
    <span>
      <button
        aria-describedby={copyError ? copyErrorId : undefined}
        className={props.className ?? "f9-wk-btn-quiet f9-copy-button"}
        type="button"
        onClick={() => void copyToClipboard()}
      >
        {copyError ? "Try again" : copied ? "Copied!" : (props.label ?? "Copy link")}
      </button>
      <span aria-live="polite" className="f9-sr-only" id={copyErrorId} role="status">
        {copyError ?? (copied ? "Copied." : "")}
      </span>
      {copyError ? <span className="f9-wk-notice is-error">{copyError}</span> : null}
    </span>
  );
}
