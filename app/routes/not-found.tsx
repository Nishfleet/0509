import { Link } from "react-router";

export const meta = () => [{ title: "Page not found | Five to Nine" }];

export function loader() {
  return new Response(null, { status: 404 });
}

export default function NotFoundPage() {
  return (
    <main className="f9-error-page">
      <div className="f9-container f9-error-layout">
        <section className="f9-error-card">
          <span className="f9-wk-kick">Five to Nine</span>
          <h1>Page not found</h1>
          <p>The page you asked for does not exist.</p>
          <div className="f9-action-row">
            <Link className="f9-wk-btn" to="/">
              Back to Five to Nine
            </Link>
            <Link className="f9-wk-btn-quiet" to="/search">
              Open search
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
