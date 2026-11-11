import { describe, it, expect } from "vitest";
import { passwordProblems, errorMessage, detailLines } from "../adminUtils";
import { acceptFix, distanceMeters } from "../geo";
import { normRoute, routeBody, CONTRACT } from "../adminApi";

describe("password rule (10+ chars, upper, lower, digit)", () => {
  it("accepts a strong password", () => expect(passwordProblems("RootPass2024x")).toEqual([]));
  it("lists every missing requirement", () => expect(passwordProblems("short")).toEqual(["at least 10 characters", "an upper-case letter", "a digit"]));
});
describe("errorMessage", () => {
  it("never leaks structure for network errors", () => expect(errorMessage({ code: "NETWORK", status: 0 })).toMatch(/Cannot reach the server/));
  it("403 becomes a permission message", () => expect(errorMessage({ status: 403, code: "FORBIDDEN", message: "x" })).toBe("You do not have permission for this action."));
  it("version conflicts ask for a reload", () => expect(errorMessage({ status: 409, code: "VERSION_CONFLICT" })).toMatch(/Reload/));
  it("adds the server's detail lines", () => expect(errorMessage({ status: 400, code: "VALIDATION_ERROR", message: "Password is weak.", details: { requirements: ["a digit"] } })).toBe("Password is weak. a digit"));
  it("ignores object details such as nearby places", () => expect(detailLines({ nearby: [{ id: 1, name: "X" }] })).toEqual([]));
});
describe("GPS point filter: accuracy <= 25 m and >= 3 m apart", () => {
  const a = { latitude: 13.25478, longitude: 74.78513 };
  it("rejects weak fixes", () => expect(acceptFix({ ...a, accuracy: 26 }, null)).toEqual({ ok: false, reason: "weak" }));
  it("accepts the first good fix", () => expect(acceptFix({ ...a, accuracy: 25 }, null).ok).toBe(true));
  it("rejects a fix closer than 3 m to the last point", () => expect(acceptFix({ latitude: a.latitude + 0.00001, longitude: a.longitude, accuracy: 5 }, a)).toEqual({ ok: false, reason: "close" }));
  it("accepts a fix 11 m away", () => { const b = { latitude: a.latitude + 0.0001, longitude: a.longitude, accuracy: 5 }; expect(distanceMeters(a, b)).toBeGreaterThan(10); expect(acceptFix(b, a).ok).toBe(true); });
});
describe("route adapters", () => {
  it("keeps null as Not verified and orders points/waypoints by sequence", () => {
    const r = normRoute({ id: 3, routeName: "A", sourceLocationId: 1, destinationLocationId: 2, hasStairs: null, status: "draft", versionNumber: 2,
      points: [{ sequenceNumber: 2, latitude: 1, longitude: 1 }, { sequenceNumber: 1, latitude: 0, longitude: 0 }], waypoints: [{ sequenceNumber: 2, locationId: 9 }, { sequenceNumber: 1, locationId: 8 }] });
    expect(r.hasStairs).toBeNull(); expect(r.hasRamp).toBeNull(); expect(r.points.map((p) => p.sequenceNumber)).toEqual([1, 2]); expect(r.waypointIds).toEqual([8, 9]);
  });
  const f = { sourceId: "1", destinationId: "2", name: " Via lawn ", directionality: "bidirectional", hasStairs: false, hasRamp: null, isCovered: true, notes: "" };
  it("builds a create body with numeric IDs and three-state values", () => {
    const b = routeBody(f, { draft: true, waypointIds: [4, 5] });
    expect(b).toMatchObject({ routeName: "Via lawn", sourceLocationId: 1, destinationLocationId: 2, hasStairs: false, hasRamp: null, isCovered: true });
    expect(CONTRACT.waypointsAs).toBe("objects"); expect(b.waypoints).toEqual([{ locationId: 4, sequenceNumber: 1 }, { locationId: 5, sequenceNumber: 2 }]);
  });
  it("only sends endpoints for drafts and points only when re-recording", () => {
    const b = routeBody(f, { draft: false, expectedVersion: 3 });
    expect(b).not.toHaveProperty("sourceLocationId"); expect(b).not.toHaveProperty("points"); expect(b.expectedVersion).toBe(3);
  });
});
