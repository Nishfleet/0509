const DELETE_USER_API_KEYS = `DELETE FROM apikey WHERE referenceId = ?`;

export function deleteApiKeysForUser(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare(DELETE_USER_API_KEYS).bind(userId);
}
