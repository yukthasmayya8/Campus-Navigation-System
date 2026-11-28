/**
 * Shared GPS and spatial decision thresholds.
 *
 * Keeping these in one place makes the conservative interpretation of browser
 * accuracy explicit. Browser-reported accuracy is an estimate, not a guaranteed
 * error bound, so safety-related thresholds use a multiplier where noted.
 */
export const GPS_THRESHOLDS = Object.freeze({
  captureTargetM: 20,
  captureMaxM: 30,
  captureStaleMs: 15000,
  navigationMaxM: 30,
  navigationStaleMs: 20000,
  suggestionMaxAccuracyM: 40,
  suggestionMaxDistanceM: 80,
  boundaryAccuracyM: 30,
  buildingStaleMs: 15000,
  ambiguousGapM: 12,
  hysteresisM: 15,
  switchFixes: 3,
  offPathBaseM: 30,
  arrivalBaseM: 15,
  matchCandidateDistanceM: 100,
  segmentSwitchMarginM: 5,
  /** Conservative multiplier for estimated horizontal accuracy. */
  accuracySafetyFactor: 2,
  arrivalAccuracyAllowanceM: 5,
});
