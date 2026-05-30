import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  playersTable,
  scoresTable,
  roundKudosTable,
  roundCommentsTable,
  roundGroupAssignmentsTable,
  type Round,
} from "@workspace/db";
import { summarizeRound } from "./scoring";

export type FeedPlayer = { playerId: number; playerName: string; userId: number | null };

export type FeedItem = {
  roundId: number;
  tripId: number | null;
  name: string;
  course: string | null;
  date: string | null;
  completedAt: string | null;
  updatedAt: string;
  visibility: "public" | "private";
  players: FeedPlayer[];
  summary: {
    leaderName: string | null;
    leaderNet: number | null;
    leaderGross: number | null;
    holesPlayed: number;
    totalHoles: number;
  };
  kudosCount: number;
  commentCount: number;
  viewerHasKudosed: boolean;
};

// Build feed items for an arbitrary list of round rows. Loads all dependencies
// (players, scores, assignments, kudos, comments) in bulk to avoid N+1.
export async function summarizeFeedItems(rounds: Round[], viewerId: number): Promise<FeedItem[]> {
  if (rounds.length === 0) return [];
  const roundIds = rounds.map(r => r.id);
  const tripIds = Array.from(new Set(rounds.map(r => r.tripId).filter((x): x is number => x !== null)));

  const [players, scores, assignments, kudosCounts, commentCounts, viewerKudos] = await Promise.all([
    db.select().from(playersTable).where(inArray(playersTable.tripId, tripIds)),
    db.select().from(scoresTable).where(inArray(scoresTable.roundId, roundIds)),
    db.select().from(roundGroupAssignmentsTable).where(inArray(roundGroupAssignmentsTable.roundId, roundIds)),
    db.select({ roundId: roundKudosTable.roundId, n: sql<number>`count(*)::int` })
      .from(roundKudosTable).where(inArray(roundKudosTable.roundId, roundIds))
      .groupBy(roundKudosTable.roundId),
    db.select({ roundId: roundCommentsTable.roundId, n: sql<number>`count(*)::int` })
      .from(roundCommentsTable).where(inArray(roundCommentsTable.roundId, roundIds))
      .groupBy(roundCommentsTable.roundId),
    db.select({ roundId: roundKudosTable.roundId })
      .from(roundKudosTable).where(and(inArray(roundKudosTable.roundId, roundIds), eq(roundKudosTable.userId, viewerId))),
  ]);

  const playersByTrip = new Map<number, typeof players>();
  for (const p of players) {
    if (p.tripId === null) continue;
    const arr = playersByTrip.get(p.tripId) ?? [];
    arr.push(p);
    playersByTrip.set(p.tripId, arr);
  }
  const scoresByRound = new Map<number, Map<number, (number | null)[]>>();
  for (const s of scores) {
    const m = scoresByRound.get(s.roundId) ?? new Map<number, (number | null)[]>();
    m.set(s.playerId, s.holeScores as (number | null)[]);
    scoresByRound.set(s.roundId, m);
  }
  const assignsByRound = new Map<number, { playerId: number; groupNumber: number }[]>();
  for (const a of assignments) {
    const arr = assignsByRound.get(a.roundId) ?? [];
    arr.push({ playerId: a.playerId, groupNumber: a.groupNumber });
    assignsByRound.set(a.roundId, arr);
  }
  const kudosCountByRound = new Map(kudosCounts.map(k => [k.roundId, k.n]));
  const commentCountByRound = new Map(commentCounts.map(c => [c.roundId, c.n]));
  const viewerKudosed = new Set(viewerKudos.map(k => k.roundId));

  return rounds.map((r): FeedItem => {
    const tripPlayers = r.tripId == null ? [] : (playersByTrip.get(r.tripId) ?? []);
    const summary = summarizeRound({
      roundId: r.id,
      par: r.par as number[],
      holeHcp: r.holeHcp as number[],
      handicapMode: r.handicapMode,
      course: { slope: r.courseSlope, rating: r.courseRating, totalPar: (r.par as number[]).reduce((a, b) => a + b, 0) },
      players: tripPlayers.map(p => ({ id: p.id, name: p.name, handicap: p.handicap })),
      scores: scoresByRound.get(r.id) ?? new Map(),
      assignments: assignsByRound.get(r.id) ?? [],
    });
    return {
      roundId: r.id,
      tripId: r.tripId ?? null,
      name: r.name,
      course: r.course ?? null,
      date: r.date ?? null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      visibility: r.visibility,
      players: tripPlayers.map(p => ({ playerId: p.id, playerName: p.name, userId: p.userId ?? null })),
      summary,
      kudosCount: kudosCountByRound.get(r.id) ?? 0,
      commentCount: commentCountByRound.get(r.id) ?? 0,
      viewerHasKudosed: viewerKudosed.has(r.id),
    };
  });
}
