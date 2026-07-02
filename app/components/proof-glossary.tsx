export function ProofGlossary() {
  return (
    <section className="f9-proof-packet" aria-label="Source status glossary">
      <div>
        <span className="f9-app-kicker">Source glossary</span>
        <h3>How to read evidence labels</h3>
        <p className="f9-muted-copy">
          Use these labels before sharing a change with teammates or clients.
        </p>
      </div>
      <dl className="proof-trail-list">
        <div>
          <dt>Verified evidence</dt>
          <dd>A stored screenshot, page record, or source link is attached.</dd>
        </div>
        <div>
          <dt>Check-spotted</dt>
          <dd>The scheduled check saw the change; review it before sharing externally.</dd>
        </div>
        <div>
          <dt>Needs review</dt>
          <dd>The signal is useful, but the source trail is not complete yet.</dd>
        </div>
        <div>
          <dt>Evidence unavailable</dt>
          <dd>Five to Nine cannot show enough source evidence for a confident decision.</dd>
        </div>
      </dl>
    </section>
  );
}
