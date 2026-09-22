/**
 * Liveness for the Worker itself. Deliberately reads nothing: a health check
 * that queries the database reports the database, and then cannot answer when
 * the thing you actually asked about — is this Worker serving — is what failed.
 */
export function loader() {
  return Response.json({
    status: "ok",
    app: "0509",
    timestamp: new Date().toISOString(),
  });
}
