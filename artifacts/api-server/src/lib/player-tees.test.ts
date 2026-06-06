import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePlayerTees, playerTeeIdsToDelete, type DesiredPlayerTee } from "./player-tees";

const card = (playerId: number): DesiredPlayerTee => ({
  playerId, teeBox: "Blue", courseRating: 71.4, courseSlope: 125,
  par: Array(18).fill(4), holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
});

describe("validatePlayerTees", () => {
  it("accepts well-formed cards for players in the round's trip", () => {
    const r = validatePlayerTees([card(1), card(2)], new Set([1, 2, 3]));
    assert.equal(r.ok, true);
  });
  it("rejects a player not in the trip", () => {
    const r = validatePlayerTees([card(9)], new Set([1, 2]));
    assert.equal(r.ok, false);
  });
  it("rejects a non-length-18 par or holeHcp", () => {
    assert.equal(validatePlayerTees([{ ...card(1), par: [4, 4, 4] }], new Set([1])).ok, false);
    assert.equal(validatePlayerTees([{ ...card(1), holeHcp: [1] }], new Set([1])).ok, false);
  });
  it("rejects duplicate playerIds", () => {
    assert.equal(validatePlayerTees([card(1), card(1)], new Set([1])).ok, false);
  });
});

describe("playerTeeIdsToDelete", () => {
  it("returns existing override players not present in the desired set", () => {
    assert.deepEqual(playerTeeIdsToDelete([1, 2, 3], [2]).sort(), [1, 3]);
  });
  it("empty desired clears all existing", () => {
    assert.deepEqual(playerTeeIdsToDelete([1, 2], []).sort(), [1, 2]);
  });
});
