import { useEffect, useId, useRef, useState } from "react";

export function toUtcObservationTime(localValue: string) {
  if (!localValue) return "";
  const parsed = new Date(localValue);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

export function ProviderObservationTimeField() {
  const helpId = useId();
  const localInputRef = useRef<HTMLInputElement>(null);
  const [observedAt, setObservedAt] = useState("");
  const updateObservedAt = (localValue: string) => {
    setObservedAt(toUtcObservationTime(localValue));
  };

  useEffect(() => {
    const input = localInputRef.current;
    if (!input) return;
    const handleChange = () => setObservedAt(toUtcObservationTime(input.value));
    input.addEventListener("change", handleChange);
    return () => input.removeEventListener("change", handleChange);
  }, []);

  return (
    <label className="f9-field">
      <span>Provider observation time (your local time)</span>
      <input
        aria-describedby={helpId}
        name="observedAtLocal"
        onInput={(event) => updateObservedAt(event.currentTarget.value)}
        ref={localInputRef}
        required
        type="datetime-local"
      />
      <input name="observedAt" type="hidden" value={observedAt} />
      <span className="f9-wk-dim" id={helpId}>
        Five to Nine converts this to an exact UTC instant before recording the evidence.
      </span>
    </label>
  );
}
