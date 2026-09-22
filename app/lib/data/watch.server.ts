export function watchConfigUpdate(
  db: D1Database,
  watchId: string,
  configJson: string,
): D1PreparedStatement {
  return db
    .prepare("UPDATE watch SET config_json = ? WHERE id = ?")
    .bind(configJson, watchId);
}
