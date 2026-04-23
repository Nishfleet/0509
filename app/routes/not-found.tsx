import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <main className="error-shell">
      <div className="container error-card">
        <p className="eyebrow">Five to Nine</p>
        <h1>Page not found</h1>
        <p>The route you asked for does not exist in this rebuild.</p>
        <div className="hero-actions">
          <Link className="button button-primary" to="/">
            Back to Five to Nine
          </Link>
          <Link className="button button-secondary" to="/search">
            Open search
          </Link>
        </div>
      </div>
    </main>
  );
}
