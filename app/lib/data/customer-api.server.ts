/**
 * Customer API domain barrel (keys, agent audit/memory, client rooms, Meta connection).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs.
 */

export {
  findAgentActionAuditByIdempotencyKey,
  listRecentAgentActionAudits,
  createAgentActionAudit,
  claimAgentActionAudit,
  reclaimRetryableAgentActionAudit,
  finishAgentActionAudit,
  closeCounterMoveFollowUp,
} from "~/lib/data/customer-api-agent.server";

export {
  upsertAgentMemory,
  listAgentMemory,
  listAgentMemoryForClientRooms,
} from "~/lib/data/customer-api-memory.server";

export {
  getClientRoom,
  getClientRoomByName,
  upsertClientRoom,
  listClientRooms,
} from "~/lib/data/customer-api-rooms.server";

export {
  listCustomerApiKeys,
  insertCustomerApiKey,
  getActiveCustomerApiKeyByHash,
  isActiveCustomerApiKey,
  recordCustomerApiKeyUsed,
  revokeCustomerApiKey,
  getCustomerMetaConnection,
  upsertCustomerMetaConnection,
  updateCustomerMetaConnectionStatus,
  deleteCustomerMetaConnection,
} from "~/lib/data/customer-api-keys.server";
