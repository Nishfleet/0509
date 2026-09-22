export function BriefForm({
  timezone,
  weekday,
  hour,
  nextBrief,
  error,
}: {
  timezone: string;
  weekday: number;
  hour: number;
  nextBrief: string | null;
  error: string | null;
}) {
  return (
    <form method="post">
      <h2>Weekly brief</h2>
      <label>
        Timezone
        <input name="timezone" defaultValue={timezone} autoComplete="off" />
      </label>
      <label>
        Weekday
        <input name="weekday" type="number" min={0} max={6} defaultValue={weekday} />
      </label>
      <label>
        Hour
        <input name="hour" type="number" min={0} max={23} defaultValue={hour} />
      </label>
      <button type="submit">Save brief time</button>
      {error ? <p role="alert">{error}</p> : null}
      {nextBrief ? <p>Next brief {nextBrief}</p> : null}
    </form>
  );
}
