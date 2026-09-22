export function loader() {
  return Response.json({
    status: "ok",
    app: "0509",
    timestamp: new Date().toISOString(),
  });
}
