import { Link } from "react-router";

export function loader() {
  return new Response(null, { status: 404 });
}

export default function NotFoundPage() {
  return (
    <main className="f9-error-page">
      <div className="f9-container f9-error-layout">
        <section className="f9-error-card">
          <span className="f9-app-kicker">Five to Nine</span>
          <h1>Page not found</h1>
          <p>The page you asked for does not exist.</p>
          <div className="f9-action-row">
            <Link className="f9-primary-button" to="/">
              Back to Five to Nine
            </Link>
            <Link className="f9-secondary-button" to="/search">
              Open search
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
