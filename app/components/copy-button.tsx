import { useEffect, useState } from "react";

export function CopyButton(props: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className="f9-secondary-button f9-copy-button"
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(props.value)
          .then(() => setCopied(true))
          .catch(() => {
            // Clipboard can be blocked (permissions, non-secure context) —
            // fall back to selecting nothing rather than throwing.
          });
      }}
    >
      {copied ? "Copied!" : (props.label ?? "Copy link")}
    </button>
  );
}
