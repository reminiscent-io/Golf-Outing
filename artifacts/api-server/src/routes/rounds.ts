import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, roundsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  CreateRoundBody,
  CreateRoundParams,
  ListRoundsParams,
  ListRoundsResponse,
  GetRoundParams,
  GetRoundResponse,
  UpdateRoundParams,
  UpdateRoundBody,
  UpdateRoundResponse,
  DeleteRoundParams,
} from "@workspace/api-zod";

const DEFAULT_PAR = Array(18).fill(4);
const DEFAULT_HCP = Array.from({ length: 18 }, (_, i) => i + 1);
const DEFAULT_GAMES = {
  stableford: true,
  skins: true,
  nassau: true,
  netStroke: true,
  bestBall: false,
  bestBallTeams: [],
  matchPlay: false,
  matchPlayMatches: [],
};

const router: IRouter = Router();

router.get("/trips/:tripId/rounds", async (req, res): Promise<void> => {
  const params = ListRoundsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rounds = await db.select().from(roundsTable).where(eq(roundsTable.tripId, params.data.tripId)).orderBy(roundsTable.createdAt);
  res.json(ListRoundsResponse.parse(rounds));
});

router.post("/trips/:tripId/rounds", async (req, res): Promise<void> => {
  const params = CreateRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateRoundBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [round] = await db.insert(roundsTable).values({
    tripId: params.data.tripId,
    name: parsed.data.name,
    course: parsed.data.course ?? null,
    date: parsed.data.date ?? null,
    par: (parsed.data.par as number[] | undefined) ?? DEFAULT_PAR,
    holeHcp: (parsed.data.holeHcp as number[] | undefined) ?? DEFAULT_HCP,
    gamesConfig: parsed.data.gamesConfig ?? DEFAULT_GAMES,
    handicapMode: parsed.data.handicapMode ?? "net",
    teeBox: parsed.data.teeBox ?? null,
    courseRating: parsed.data.courseRating ?? null,
    courseSlope: parsed.data.courseSlope ?? null,
  }).returning();
  res.status(201).json(GetRoundResponse.parse(ser(round)));
});

router.get("/trips/:tripId/rounds/:roundId", async (req, res): Promise<void> => {
  const params = GetRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [round] = await db.select().from(roundsTable).where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  res.json(GetRoundResponse.parse(ser(round)));
});

router.patch("/trips/:tripId/rounds/:roundId", async (req, res): Promise<void> => {
  const params = UpdateRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRoundBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.course !== undefined) updateData.course = parsed.data.course;
  if (parsed.data.date !== undefined) updateData.date = parsed.data.date;
  if (parsed.data.par !== undefined) updateData.par = parsed.data.par;
  if (parsed.data.holeHcp !== undefined) updateData.holeHcp = parsed.data.holeHcp;
  if (parsed.data.gamesConfig !== undefined) updateData.gamesConfig = parsed.data.gamesConfig;
  if (parsed.data.handicapMode !== undefined) updateData.handicapMode = parsed.data.handicapMode;
  if (parsed.data.teeBox !== undefined) updateData.teeBox = parsed.data.teeBox;
  if (parsed.data.courseRating !== undefined) updateData.courseRating = parsed.data.courseRating;
  if (parsed.data.courseSlope !== undefined) updateData.courseSlope = parsed.data.courseSlope;

  const [round] = await db.update(roundsTable).set(updateData)
    .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)))
    .returning();
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  res.json(UpdateRoundResponse.parse(ser(round)));
});

router.delete("/trips/:tripId/rounds/:roundId", async (req, res): Promise<void> => {
  const params = DeleteRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(roundsTable).where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  res.sendStatus(204);
});

export default router;
