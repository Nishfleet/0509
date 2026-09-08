import { useEffect, useState } from "react";

type LocalTimeProps = {
  iso: string | null | undefined;
  mode?: "datetime" | "date";
  fallback?: string;
};

function formatUtc(date: Date, mode: "datetime" | "date") {
  if (mode === "date") {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  }

  const formatted = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);

  return `${formatted} UTC`;
}

function formatLocal(date: Date, mode: "datetime" | "date") {
  if (mode === "date") {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Renders a timestamp in the viewer's browser locale and timezone.
 *
 * Hydration-safe: the server render and the client's first render both show a
 * deterministic UTC-labeled string, then an effect swaps in the browser-local
 * formatting after mount.
 */
export function LocalTime({ iso, mode = "datetime", fallback = "—" }: LocalTimeProps) {
  const parsed = iso ? new Date(iso) : null;
  const isValid = parsed !== null && !Number.isNaN(parsed.getTime());

  const [label, setLabel] = useState(() => (isValid ? formatUtc(parsed, mode) : null));

  useEffect(() => {
    if (!iso) {
      setLabel(null);
      return;
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      setLabel(null);
      return;
    }

    setLabel(formatLocal(date, mode));
  }, [iso, mode]);

  if (!isValid) {
    return <>{fallback}</>;
  }

  return <time dateTime={iso ?? undefined}>{label ?? formatUtc(parsed, mode)}</time>;
}
