CREATE INDEX IF NOT EXISTS idx_agent_memory_user_client_room_updated
  ON agent_memory(user_id, client_room_id, updated_at DESC)
  WHERE client_room_id IS NOT NULL;
