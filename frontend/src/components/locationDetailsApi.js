import { api } from "../../api";

// GET /api/locations/:id
// Returns the location, or throws an ApiError with status 404 when the
// location is inactive or missing.
//
// NOTE: check how src/api.js expects the path (with or without "/api")
// by looking at an existing call such as getLocations(), and match it.
export function getLocation(locationId) {
  return api(`/api/locations/${locationId}`);
}
