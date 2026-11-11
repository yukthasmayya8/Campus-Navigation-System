// Tile source for the admin maps. Check your provider's usage policy (the public OSM server forbids heavy use).
export const TILE_URL = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_TILE_URL) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = "© OpenStreetMap contributors";
export const DEFAULT_CENTER = [13.2548, 74.7851]; // SMVITM campus; used only when no location exists yet
