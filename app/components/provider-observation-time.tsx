import { useId, useState } from "react";

export function toUtcObservationTime(localValue: string) {
  if (!localValue) return "";
  const parsed = new Date(localValue);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

export function ProviderObservationTimeField() {
  const helpId = useId();
  const [observedAt, setObservedAt] = useState("");

  return (
    <label className="f9-field">
      <span>Provider observation time (your local time)</span>
      <input
        aria-describedby={helpId}
        name="observedAtLocal"
        onInput={(event) => {
          setObservedAt(toUtcObservationTime(event.currentTarget.value));
        }}
        required
        type="datetime-local"
      />
      <input name="observedAt" type="hidden" value={observedAt} />
      <span className="f9-muted-copy" id={helpId}>
        Five to Nine converts this to an exact UTC instant before recording the evidence.
      </span>
    </label>
  );
}
