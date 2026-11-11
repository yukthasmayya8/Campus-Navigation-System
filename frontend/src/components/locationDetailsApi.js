import { api } from "../api";

// GET /api/locations/:id
// Returns the location, or throws an ApiError with status 404 when the
// location is inactive or missing.
//
export function getLocation(locationId) {
  return api(`/locations/${locationId}`);
}
