export const SEARCH_CONSENT_MISSING = "Tick the box to confirm you understand before your card can be listed.";

export function CopyButton({ url }: { url: string | null }) {
  return (
    <button
      type="button"
      disabled={url === null}
      onClick={() => {
        if (url !== null) void navigator.clipboard.writeText(`${location.origin}${url}`);
      }}
    >
      Copy link
    </button>
  );
}

export function SearchSetting({ indexable }: { indexable: boolean }) {
  if (indexable) {
    return (
      <section aria-labelledby="card-search">
        <h2 id="card-search">Search engines</h2>
        <p>Search engines can find your card. Anyone searching can see your rank and every competitor you track.</p>
        <form method="post">
          <input type="hidden" name="intent" value="unlist" />
          <button type="submit">Make it unlisted again</button>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="card-search">
      <h2 id="card-search">Search engines</h2>
      <p>Your card is unlisted. Only people you send the link to can see it, and search engines are told not to show it.</p>
      <form method="post">
        <input type="hidden" name="intent" value="list" />
        <p>If you let search engines find your card:</p>
        <ul>
          <li>Anyone can find it by searching, not only people you send it to.</li>
          <li>They will see your rank and the name of every competitor you track.</li>
          <li>If you turn this off later, search engines can take days or weeks to drop it, and copies can stay in their caches.</li>
        </ul>
        <label>
          <input type="checkbox" name="understood" value="yes" required />
          I understand that anyone will be able to find my card and see which competitors I track.
        </label>
        <button type="submit">Let search engines find my card</button>
      </form>
    </section>
  );
}
