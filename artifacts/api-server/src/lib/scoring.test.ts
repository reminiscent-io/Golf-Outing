import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTeamNassau, type TeamNassauSlot } from "./scoring";

function holes(values: Array<number | null>): (number | null)[] {
  return values.length === 18 ? values : [...values, ...Array(18 - values.length).fill(null)];
}

const par = Array(18).fill(4);
const holeHcp = Array.from({ length: 18 }, (_, i) => i + 1);

describe("computeTeamNassau", () => {
  it("returns no matches when there are no groups", () => {
    const result = computeTeamNassau([], new Map(), par, holeHcp, 0, "gross", {});
    assert.deepEqual(result.matches, []);
  });

  it("emits one match per group with both teams filled", () => {
    // Group 1: player 1 (slot 1), player 2 (slot 3). Team A = [1], Team B = [2].
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "Alpha", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "Bravo", handicap: 0, groupNumber: 1, slotIndex: 3 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])], // team A total = 71
      [2, holes([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5])], // team B total = 73
    ]);

    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    assert.equal(result.matches.length, 1);
    const m = result.matches[0];
    assert.equal(m.groupNumber, 1);
    assert.equal(m.teamA, 1);
    assert.equal(m.teamB, 2);
    assert.deepEqual(m.teamAPlayerIds, [1]);
    assert.deepEqual(m.teamBPlayerIds, [2]);
    assert.equal(m.front, "A"); // A won hole 1 (3 vs 4), halved 8 others
    assert.equal(m.frontMargin, 1);
    assert.equal(m.back, "A"); // A won hole 18 (4 vs 5), halved 8 others
    assert.equal(m.backMargin, 1);
    assert.equal(m.total, "A"); // A wins 2 holes overall, B wins 0
    assert.equal(m.totalMargin, 2);
  });

  it("uses best-ball within a team", () => {
    // Team A has two players; only partner 2's lower score should count.
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A1", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "A2", handicap: 0, groupNumber: 1, slotIndex: 2 },
      { playerId: 3, playerName: "B1", handicap: 0, groupNumber: 1, slotIndex: 3 },
      { playerId: 4, playerName: "B2", handicap: 0, groupNumber: 1, slotIndex: 4 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([5])],          // A's worse
      [2, holes([3])],          // A's better — team A hole 1 = 3
      [3, holes([4])],
      [4, holes([4])],          // Team B hole 1 = 4
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    const m = result.matches[0];
    // Team A wins hole 1 on best-ball (3 vs 4). Other holes all null — not scored.
    assert.equal(m.front, "A");
    assert.equal(m.frontMargin, 1);
    assert.equal(m.back, null);
    assert.equal(m.total, "A");
    assert.equal(m.totalMargin, 1);
  });

  it("skips groups with no players on one side", () => {
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A1", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "A2", handicap: 0, groupNumber: 1, slotIndex: 2 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([4])],
      [2, holes([4])],
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    assert.deepEqual(result.matches, []);
  });

  it("handles multiple groups with correct global team numbers", () => {
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "B", handicap: 0, groupNumber: 1, slotIndex: 3 },
      { playerId: 3, playerName: "C", handicap: 0, groupNumber: 2, slotIndex: 1 },
      { playerId: 4, playerName: "D", handicap: 0, groupNumber: 2, slotIndex: 3 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([])], [2, holes([])], [3, holes([])], [4, holes([])],
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].teamA, 1);
    assert.equal(result.matches[0].teamB, 2);
    assert.equal(result.matches[1].teamA, 3);
    assert.equal(result.matches[1].teamB, 4);
  });

  it("halves a hole when both teams' best-ball scores are equal", () => {
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "B", handicap: 0, groupNumber: 1, slotIndex: 3 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([4])],
      [2, holes([4])],
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    // Only hole 1 scored, halved → front/total both halved, back null
    const m = result.matches[0];
    assert.equal(m.front, "halved");
    assert.equal(m.frontMargin, 0);
    assert.equal(m.back, null);
    assert.equal(m.total, "halved");
    assert.equal(m.totalMargin, 0);
  });
});
