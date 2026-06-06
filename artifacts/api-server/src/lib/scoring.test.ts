import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePlayerStats,
  computeSkins,
  computeTeamNassau,
  resolvePlayingHandicaps,
  summarizeRound,
  type SummarizeInputs,
  type TeamNassauSlot,
  type PlayerTee,
} from "./scoring";

function holes(values: Array<number | null>): (number | null)[] {
  return values.length === 18 ? values : [...values, ...Array(18 - values.length).fill(null)];
}

const par = Array(18).fill(4);
const holeHcp = Array.from({ length: 18 }, (_, i) => i + 1);

// Flat reference course so that WHS Course Handicap == handicap index
// (slope 113, rating == par => CR - Par = 0). This lets the test set up
// group/field references purely from raw handicaps.
const flatCourse = { slope: 113, rating: 72, totalPar: 72 };

// Build the per-player holeHcp / playingHandicap maps for a set of slots/players
// by resolving playing handicaps through the new group-relative reference.
function nassauMaps(
  slots: TeamNassauSlot[],
  mode: "net" | "gross"
): { holeHcpByPlayer: Map<number, number[]>; playingByPlayer: Map<number, number> } {
  const players = slots.map(s => ({ id: s.playerId, handicap: s.handicap }));
  const assignments = slots.map(s => ({ playerId: s.playerId, groupNumber: s.groupNumber }));
  const defTee: PlayerTee = { par, holeHcp, course: flatCourse };
  const resolved = resolvePlayingHandicaps(players, new Map(), defTee, assignments, mode);
  return {
    holeHcpByPlayer: new Map(players.map(p => [p.id, holeHcp])),
    playingByPlayer: new Map([...resolved].map(([id, r]) => [id, r.playingHandicap])),
  };
}

describe("computeTeamNassau", () => {
  it("returns no matches when there are no groups", () => {
    const result = computeTeamNassau([], new Map(), new Map(), new Map(), "gross");
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

    const maps = nassauMaps(slots, "gross");
    const result = computeTeamNassau(slots, scores, maps.holeHcpByPlayer, maps.playingByPlayer, "gross");
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
    const maps = nassauMaps(slots, "gross");
    const result = computeTeamNassau(slots, scores, maps.holeHcpByPlayer, maps.playingByPlayer, "gross");
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
    const maps = nassauMaps(slots, "gross");
    const result = computeTeamNassau(slots, scores, maps.holeHcpByPlayer, maps.playingByPlayer, "gross");
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
    const maps = nassauMaps(slots, "gross");
    const result = computeTeamNassau(slots, scores, maps.holeHcpByPlayer, maps.playingByPlayer, "gross");
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
    const maps = nassauMaps(slots, "gross");
    const result = computeTeamNassau(slots, scores, maps.holeHcpByPlayer, maps.playingByPlayer, "gross");
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
    const maps = nassauMaps(slots, "net");
    const result = computeTeamNassau(slots, scores, maps.holeHcpByPlayer, maps.playingByPlayer, "net");
    const g2 = result.matches.find(m => m.groupNumber === 2)!;
    // Player 4 has 2 strokes vs player 3 across hardest holes (idx 1 and 2).
    // Hole 1 (hcp idx 1): player 3 net 4, player 4 net 5-1=4 → halved.
    // Hole 2 (hcp idx 2): player 3 net 4, player 4 net 5-1=4 → halved.
    assert.equal(g2.front, "halved");
    assert.equal(g2.frontMargin, 0);
  });
});

describe("computePlayerStats with group-relative net", () => {
  it("gives a group's high handicapper strokes off the group low, not field low", () => {
    // Field low is 0 (some other group). This player is in a group where the
    // low is 10 and they have 12 → 2 net strokes (one each on hcp idx 1, 2).
    // Set up a group whose min Course Handicap is 10 (flat course => CH == idx),
    // so player 4 resolves to a playing handicap of 2 — same reference the old
    // refMinHcp=10 produced.
    const players = [
      { id: 3, name: "G2A", handicap: 10 },
      { id: 4, name: "G2B", handicap: 12 },
    ];
    const assignments = [
      { playerId: 3, groupNumber: 2 },
      { playerId: 4, groupNumber: 2 },
    ];
    const defTee: PlayerTee = { par, holeHcp, course: flatCourse };
    const resolved = resolvePlayingHandicaps(players, new Map(), defTee, assignments, "net");
    const player = { id: 4, name: "G2B", handicap: 12 };
    const scores = holes([5, 5, 4, 4]);
    const stats = computePlayerStats(player, scores, par, holeHcp, resolved.get(4)!.playingHandicap);
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
    // Group min map: 1,2 ref 0; 3,4 ref 10 (flat course => CH == index).
    const assignments = [
      { playerId: 1, groupNumber: 1 },
      { playerId: 2, groupNumber: 1 },
      { playerId: 3, groupNumber: 2 },
      { playerId: 4, groupNumber: 2 },
    ];
    const defTee: PlayerTee = { par, holeHcp, course: flatCourse };
    const resolved = resolvePlayingHandicaps(players, new Map(), defTee, assignments, "net");
    const holeHcpByPlayer = new Map(players.map(p => [p.id, holeHcp]));
    const playingByPlayer = new Map([...resolved].map(([id, r]) => [id, r.playingHandicap]));
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
    const { perHole } = computeSkins(players, scores, holeHcpByPlayer, playingByPlayer);
    assert.equal(perHole[0].tied, true);
  });
});

describe("per-player tee threading", () => {
  it("per-hole strokes use each player's own holeHcp", () => {
    // Two players with identical playing handicap (1 stroke), but their stroke
    // index orderings differ: P1 has hole 1 as index 1 (hardest); P2 has hole 1
    // as index 18 (easiest). The single stroke lands on hole 1 for P1 but not P2.
    const p1 = { id: 1, name: "P1", handicap: 1 };
    const p2 = { id: 2, name: "P2", handicap: 1 };
    const playing = 1;
    const holeHcpP1 = Array.from({ length: 18 }, (_, i) => i + 1);          // hole 1 => idx 1
    const holeHcpP2 = Array.from({ length: 18 }, (_, i) => 18 - i);          // hole 1 => idx 18
    const scores = holes([4, 4]);
    const s1 = computePlayerStats(p1, scores, par, holeHcpP1, playing);
    const s2 = computePlayerStats(p2, scores, par, holeHcpP2, playing);
    // Hole 1: P1 gets the stroke (idx 1 <= 1) → net 3; P2 does not (idx 18) → net 4.
    assert.equal(s1.netHoles[0], 3);
    assert.equal(s2.netHoles[0], 4);
    assert.notEqual(s1.netHoles[0], s2.netHoles[0]);
  });

  it("Stableford uses each player's own par", () => {
    // Same gross + zero strokes, but P1 plays a par-3 first hole and P2 a par-5.
    const p1 = { id: 1, name: "P1", handicap: 0 };
    const p2 = { id: 2, name: "P2", handicap: 0 };
    const parP1 = [3, ...Array(17).fill(4)];
    const parP2 = [5, ...Array(17).fill(4)];
    const scores = holes([4]); // gross 4 on hole 1 only
    const s1 = computePlayerStats(p1, scores, parP1, holeHcp, 0);
    const s2 = computePlayerStats(p2, scores, parP2, holeHcp, 0);
    // Net 4 vs par 3 => bogey => 1 pt. Net 4 vs par 5 => birdie => 3 pts.
    assert.equal(s1.sfTotal, 1);
    assert.equal(s2.sfTotal, 3);
  });

  it("mixed-tee net equity: higher-CH player gets strokes equal to the CH differential", () => {
    // P1 index 12 tough tee (slope 140, CR 74 => CH 17).
    // P2 index 12 easy tee (slope 100, CR 70 => CH 9).
    // Group-relative reference is min CH (9), so P1 plays off 17 - 9 = 8.
    const players = [{ id: 1, handicap: 12 }, { id: 2, handicap: 12 }];
    const assignments = [
      { playerId: 1, groupNumber: 1 },
      { playerId: 2, groupNumber: 1 },
    ];
    const toughTee: PlayerTee = { par, holeHcp, course: { slope: 140, rating: 74, totalPar: 72 } };
    const easyTee: PlayerTee = { par, holeHcp, course: { slope: 100, rating: 70, totalPar: 72 } };
    const tees = new Map<number, PlayerTee>([[1, toughTee], [2, easyTee]]);
    const defTee: PlayerTee = { par, holeHcp, course: flatCourse };
    const resolved = resolvePlayingHandicaps(players, tees, defTee, assignments, "net");
    assert.equal(resolved.get(1)!.courseHandicap, 17);
    assert.equal(resolved.get(2)!.courseHandicap, 9);
    assert.equal(resolved.get(1)!.playingHandicap, 8); // 17 - 9

    // P1 (playing 8) shoots par on every hole. With holeHcp idx == hole number,
    // a playing handicap of 8 grants exactly one stroke on holes 1..8 (idx 1..8).
    const p1 = { id: 1, name: "P1", handicap: 12 };
    const grossPar = holes(Array(18).fill(4));
    const s1 = computePlayerStats(p1, grossPar, toughTee.par, toughTee.holeHcp, resolved.get(1)!.playingHandicap);
    // Holes 1..8 (idx 1..8) receive a stroke → net 3; holes 9..18 → net 4.
    for (let h = 0; h < 8; h++) assert.equal(s1.netHoles[h], 3, `hole ${h + 1} should get a stroke`);
    for (let h = 8; h < 18; h++) assert.equal(s1.netHoles[h], 4, `hole ${h + 1} should not get a stroke`);
    // Total strokes received == CH differential (8).
    const strokesReceived = s1.grossHoles.reduce<number>((acc, g, h) => acc + (g! - s1.netHoles[h]!), 0);
    assert.equal(strokesReceived, 8);
  });
});

describe("summarizeRound", () => {
  function baseInputs(): SummarizeInputs {
    return {
      roundId: 1,
      par: Array(18).fill(4),
      holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
      handicapMode: "net",
      course: { slope: null, rating: null, totalPar: 72 },
      players: [
        { id: 10, name: "Alice", handicap: 0 },
        { id: 11, name: "Bob",   handicap: 18 },
      ],
      scores: new Map([
        [10, holes([4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4])], // 72 gross
        [11, holes([5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5])], // 90 gross
      ]),
      assignments: [],
    };
  }

  it("returns the lowest net score holder as the leader", () => {
    const out = summarizeRound(baseInputs());
    // Alice gross 72, net 72. Bob gross 90, net 72 (18 strokes). Tie — leader is alphabetical-deterministic, lowest playerId.
    assert.equal(out.holesPlayed, 18);
    assert.equal(out.totalHoles, 18);
    assert.equal(out.leaderNet, 72);
    assert.equal(out.leaderGross, 72);
    assert.ok(out.leaderName === "Alice" || out.leaderName === "Bob");
  });

  it("counts holes by max holes-played across all players in the round", () => {
    const inputs = baseInputs();
    inputs.scores = new Map([
      [10, holes([4,4,4,4,4,4,4,4,4,4,4,4])],     // 12 holes
      [11, holes([5,5,5,5,5,5,5,5])],             // 8 holes
    ]);
    const out = summarizeRound(inputs);
    assert.equal(out.holesPlayed, 12);
    assert.equal(out.totalHoles, 18);
  });

  it("returns nulls and zero leaders for an empty round", () => {
    const inputs = baseInputs();
    inputs.scores = new Map();
    const out = summarizeRound(inputs);
    assert.equal(out.holesPlayed, 0);
    assert.equal(out.leaderName, null);
    assert.equal(out.leaderNet, null);
    assert.equal(out.leaderGross, null);
  });
});

describe("resolvePlayingHandicaps", () => {
  const flatTee = (slope: number, rating: number): PlayerTee => ({
    par: Array(18).fill(4),
    holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
    course: { slope, rating, totalPar: 72 },
  });

  it("net: group-relative, plays off the lowest Course Handicap in the group", () => {
    const players = [{ id: 1, handicap: 10 }, { id: 2, handicap: 20 }];
    const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
    const def = flatTee(113, 72); // CR-Par = 0, slope 113 => CH == index
    const r = resolvePlayingHandicaps(players, new Map(), def, assignments, "net");
    assert.equal(r.get(1)!.courseHandicap, 10);
    assert.equal(r.get(2)!.courseHandicap, 20);
    assert.equal(r.get(1)!.playingHandicap, 0);  // low plays scratch
    assert.equal(r.get(2)!.playingHandicap, 10); // 20 - 10
  });

  it("gross: every player plays their full Course Handicap", () => {
    const players = [{ id: 1, handicap: 10 }, { id: 2, handicap: 20 }];
    const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
    const r = resolvePlayingHandicaps(players, new Map(), flatTee(113, 72), assignments, "gross");
    assert.equal(r.get(1)!.playingHandicap, 10);
    assert.equal(r.get(2)!.playingHandicap, 20);
  });

  it("ungrouped players fall back to the field-min Course Handicap", () => {
    const players = [{ id: 1, handicap: 5 }, { id: 2, handicap: 15 }];
    const r = resolvePlayingHandicaps(players, new Map(), flatTee(113, 72), [], "net");
    assert.equal(r.get(1)!.playingHandicap, 0);  // 5 - 5
    assert.equal(r.get(2)!.playingHandicap, 10); // 15 - 5
  });

  it("mixed tees: reference is the true min over per-player Course Handicaps", () => {
    // P1 index 12 tough tee (slope 140, CR 74 => CH = round(12*140/113 + 2) = round(14.87+2)=17)
    // P2 index 12 easy tee (slope 100, CR 70 => CH = round(12*100/113 - 2) = round(10.62-2)=9)
    const players = [{ id: 1, handicap: 12 }, { id: 2, handicap: 12 }];
    const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
    const tees = new Map<number, PlayerTee>([
      [1, flatTee(140, 74)],
      [2, flatTee(100, 70)],
    ]);
    const r = resolvePlayingHandicaps(players, tees, flatTee(113, 72), assignments, "net");
    assert.equal(r.get(1)!.courseHandicap, 17);
    assert.equal(r.get(2)!.courseHandicap, 9);
    assert.equal(r.get(2)!.playingHandicap, 0);  // min CH plays scratch
    assert.equal(r.get(1)!.playingHandicap, 8);  // 17 - 9
  });
});
