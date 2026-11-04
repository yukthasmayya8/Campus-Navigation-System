import { api } from "../../api";

// entityType is "location" or "route"
const base = (entityType, entityId) =>
  `/api/admin/${entityType === "route" ? "routes" : "locations"}/${entityId}/versions`;

// GET .../versions?limit=&offset=  ->  { total, limit, offset, items: [...] } newest first
export function getVersions(entityType, entityId, { limit = 10, offset = 0 } = {}) {
  return api(`${base(entityType, entityId)}?limit=${limit}&offset=${offset}`);
}

// GET .../versions/:n  ->  { versionNumber, modifiedAt, changeDescription, snapshot }
export function getVersion(entityType, entityId, versionNumber) {
  return api(`${base(entityType, entityId)}/${versionNumber}`);
}

// GET .../versions/compare?from=&to=  ->  { from, to, changes: [{ field, from, to }] }
export function compareVersions(entityType, entityId, from, to) {
  return api(`${base(entityType, entityId)}/compare?from=${from}&to=${to}`);
}
