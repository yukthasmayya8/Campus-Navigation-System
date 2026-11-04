// Turns an ApiError into a message a person can act on.
export function messageFor(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.status === 401) return "Log in as an administrator to see history.";
  if (err.status === 403) return "You do not have permission to see history.";
  if (err.status === 404) return "This record was not found.";
  if (err.code === "NETWORK")
    return "Cannot reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

export function formatTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown time" : d.toLocaleString();
}

const FIELD_LABELS = {
  name: "Name",
  description: "Description",
  latitude: "Latitude",
  longitude: "Longitude",
  imageUrl: "Photo",
  status: "Status",
  routeName: "Route name",
  directionality: "Direction",
  hasStairs: "Stairs",
  hasRamp: "Ramp",
  isCovered: "Covered walkway",
  notes: "Notes",
  points: "Recorded path",
  waypoints: "Waypoints",
};

export const labelFor = (field) => FIELD_LABELS[field] || field;

const VERIFIED_FIELDS = new Set(["hasStairs", "hasRamp", "isCovered"]);

// null on stairs / ramp / covered means "Not verified", never "No".
export function formatValue(field, value) {
  if (VERIFIED_FIELDS.has(field)) {
    if (value === true) return "Verified yes";
    if (value === false) return "Verified no";
    return "Not verified";
  }
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "object" && "count" in value) return `${value.count} points`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
