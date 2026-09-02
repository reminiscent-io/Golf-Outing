import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roundPath } from "./round-nav";

describe("roundPath", () => {
  it("routes a trip round under its trip", () => {
    assert.equal(roundPath(7, 42), "/trips/7/rounds/42");
  });

  it("routes a solo round to the standalone round page", () => {
    assert.equal(roundPath(null, 42), "/rounds/42");
  });

  it("treats a missing tripId as solo", () => {
    assert.equal(roundPath(undefined, 42), "/rounds/42");
  });

  it("never interpolates a null tripId into the trip path", () => {
    // Regression: the feed's create-round callback built the trip path
    // unconditionally, so solo rounds landed on /trips/null/rounds/:id — a 404
    // page, even though the round had already been saved.
    for (const tripId of [null, undefined]) {
      assert.doesNotMatch(roundPath(tripId, 42), /\/trips\/(null|undefined)\//);
    }
  });
});
