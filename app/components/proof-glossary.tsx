export function ProofGlossary() {
  return (
    <section className="f9-proof-packet" aria-label="Proof status glossary">
      <div>
        <span className="f9-app-kicker">Proof glossary</span>
        <h3>How to read proof labels</h3>
        <p className="f9-muted-copy">
          Use these labels before sharing a change with teammates or clients.
        </p>
      </div>
      <dl className="proof-trail-list">
        <div>
          <dt>Verified proof</dt>
          <dd>A stored proof snapshot is attached.</dd>
        </div>
        <div>
          <dt>Scan-spotted</dt>
          <dd>The scheduled check saw the change; review it before sharing externally.</dd>
        </div>
        <div>
          <dt>Needs review</dt>
          <dd>The signal is useful, but the proof trail is not complete yet.</dd>
        </div>
        <div>
          <dt>Proof unavailable</dt>
          <dd>Five to Nine cannot show enough source proof for a confident decision.</dd>
        </div>
      </dl>
    </section>
  );
}
