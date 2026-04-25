import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlayerMinHcp,
  computePlayerStats,
  computeSkins,
  computeTeamNassau,
  type TeamNassauSlot,
} from "./scoring";

function holes(values: Array<number | null>): (number | null)[] {
  return values.length === 18 ? values : [...values, ...Array(18 - values.length).fill(null)];
}

const par = Array(18).fill(4);
const holeHcp = Array.from({ length: 18 }, (_, i) => i + 1);

describe("computeTeamNassau", () => {
  it("returns no matches when there are no groups", () => {
    const result = computeTeamNassau([], new Map(), par, holeHcp, "gross", {});
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

    const result = computeTeamNassau(slots, scores, par, holeHcp, "gross", {});
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
    const result = computeTeamNassau(slots, scores, par, holeHcp, "gross", {});
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
    const result = computeTeamNassau(slots, scores, par, holeHcp, "gross", {});
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
    const result = computeTeamNassau(slots, scores, par, holeHcp, "gross", {});
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
    const result = computeTeamNassau(slots, scores, par, holeHcp, "gross", {});
    // Only hole 1 scored, halved → front/total both halved, back null
    const m = result.matches[0];
    assert.equal(m.front, "halved");
    assert.equal(m.frontMargin, 0);
    assert.equal(m.back, null);
    assert.equal(m.total, "halved");
    assert.equal(m.totalMargin, 0);
  });

  it("uses per-group lowest handicap as the net reference", () => {
    // Group 1: low handicap is player 1 (hcp 0). Group 2: low is player 3 (hcp 10).
    // In net mode, player 4 (hcp 12) should get strokes off player 3, NOT player 1.
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "G1A", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "G1B", handicap: 0, groupNumber: 1, slotIndex: 3 },
      { playerId: 3, playerName: "G2A", handicap: 10, groupNumber: 2, slotIndex: 1 },
      { playerId: 4, playerName: "G2B", handicap: 12, groupNumber: 2, slotIndex: 3 },
    ];
    // Player 4 (hcp 12) vs player 3 (hcp 10) → net diff is 2 strokes on the
    // two hardest holes (hcp index 1 and 2). If field-min were used instead
    // (hcp 0), player 4 would get 12 strokes — far more.
    const scores = new Map<number, (number | null)[]>([
      [3, holes([4, 4])],
      [4, holes([5, 5])], // gross +1 on each, but with group-relative net should match team A
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, "net", {});
    const g2 = result.matches.find(m => m.groupNumber === 2)!;
    // Player 4 has 2 strokes vs player 3 across hardest holes (idx 1 and 2).
    // Hole 1 (hcp idx 1): player 3 net 4, player 4 net 5-1=4 → halved.
    // Hole 2 (hcp idx 2): player 3 net 4, player 4 net 5-1=4 → halved.
    assert.equal(g2.front, "halved");
    assert.equal(g2.frontMargin, 0);
  });
});

describe("buildPlayerMinHcp", () => {
  it("returns each player's group-low handicap", () => {
    const players = [
      { id: 1, handicap: 5 },
      { id: 2, handicap: 8 },
      { id: 3, handicap: 12 },
      { id: 4, handicap: 15 },
    ];
    const assignments = [
      { playerId: 1, groupNumber: 1 },
      { playerId: 2, groupNumber: 1 },
      { playerId: 3, groupNumber: 2 },
      { playerId: 4, groupNumber: 2 },
    ];
    const min = buildPlayerMinHcp(players, assignments);
    assert.equal(min.get(1), 5);
    assert.equal(min.get(2), 5);
    assert.equal(min.get(3), 12);
    assert.equal(min.get(4), 12);
  });

  it("falls back to field-min for players without a group", () => {
    const players = [
      { id: 1, handicap: 5 },
      { id: 2, handicap: 8 },
      { id: 3, handicap: 12 },
    ];
    const assignments = [{ playerId: 1, groupNumber: 1 }];
    const min = buildPlayerMinHcp(players, assignments);
    assert.equal(min.get(1), 5);
    assert.equal(min.get(2), 5); // unassigned → field min (5)
    assert.equal(min.get(3), 5);
  });
});

describe("computePlayerStats with group-relative net", () => {
  it("gives a group's high handicapper strokes off the group low, not field low", () => {
    // Field low is 0 (some other group). This player is in a group where the
    // low is 10 and they have 12 → 2 net strokes (one each on hcp idx 1, 2).
    const player = { id: 4, name: "G2B", handicap: 12 };
    const scores = holes([5, 5, 4, 4]);
    const stats = computePlayerStats(player, scores, par, holeHcp, 10, "net", {});
    // Hole 1 (hcp 1): gross 5, gets 1 stroke → net 4
    // Hole 2 (hcp 2): gross 5, gets 1 stroke → net 4
    // Holes 3,4: gross 4, no strokes → net 4
    assert.equal(stats.netHoles[0], 4);
    assert.equal(stats.netHoles[1], 4);
    assert.equal(stats.netHoles[2], 4);
    assert.equal(stats.netHoles[3], 4);
  });
});

describe("computeSkins with per-player min handicap", () => {
  it("applies group-relative net handicap when computing skins", () => {
    const players = [
      { id: 1, name: "G1A", handicap: 0 },
      { id: 2, name: "G1B", handicap: 4 },
      { id: 3, name: "G2A", handicap: 10 },
      { id: 4, name: "G2B", handicap: 12 },
    ];
    // Group min map: 1,2 ref 0; 3,4 ref 10
    const minByPlayer = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 10],
      [4, 10],
    ]);
    // All shoot 4 on hole 1. Stroke allocation:
    // p1: 0 strokes → net 4. p2: gets 1 stroke (hcp 4 covers idx 1-4) → net 3.
    // p3: 0 strokes (group-low) → net 4. p4: gets 1 stroke → net 3.
    // Two players tie at 3 → tied, carry.
    const scores = new Map<number, (number | null)[]>([
      [1, holes([4])],
      [2, holes([4])],
      [3, holes([4])],
      [4, holes([4])],
    ]);
    const { perHole } = computeSkins(players, scores, holeHcp, minByPlayer, "net", {});
    assert.equal(perHole[0].tied, true);
  });
});
