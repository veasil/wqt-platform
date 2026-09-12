import assert from "node:assert/strict";
import { auditSessionOwnership } from "../../../scripts/audit-session-ownership.mjs";

// Called by the parent runtime scenario after it has started an owned database.
export async function runOwnershipAuditScenario(client) {
  assert.ok(client, "an already-connected owned PG client is required");
  const result = await auditSessionOwnership(client);
  assert.equal(typeof result.total, "number");
  assert.equal(
    result.organization + result.personal + result.legacy_unknown,
    result.total,
  );
  assert.equal(typeof result.currentMembershipHints, "number");
  assert.equal(typeof result.activityOrgHints, "number");
  assert.equal(typeof result.conflictingActivityOrgHints, "number");
  assert.equal(typeof result.orphanCreator, "number");
  assert.deepEqual(Object.keys(result).sort(), [
    "activityOrgHints",
    "conflictingActivityOrgHints",
    "currentMembershipHints",
    "legacy_unknown",
    "orphanCreator",
    "organization",
    "personal",
    "schema",
    "total",
  ].sort());
  return result;
}
