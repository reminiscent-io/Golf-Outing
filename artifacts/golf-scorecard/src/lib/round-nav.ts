/**
 * Build the in-app path for a round.
 *
 * Solo rounds (`tripId === null`) live at `/rounds/:roundId`; trip rounds live
 * under their trip. Interpolating a null `tripId` straight into the trip path
 * yields `/trips/null/rounds/:roundId`, which the router resolves to the 404
 * page — so every round-creation callback must route through this helper.
 */
export function roundPath(tripId: number | null | undefined, roundId: number): string {
  return tripId == null
    ? `/rounds/${roundId}`
    : `/trips/${tripId}/rounds/${roundId}`;
}
