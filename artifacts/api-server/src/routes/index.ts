import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersMeRouter from "./users-me";
import tripsRouter from "./trips";
import playersRouter from "./players";
import roundsRouter from "./rounds";
import scoresRouter from "./scores";
import scrambleScoresRouter from "./scramble-scores";
import leaderboardRouter from "./leaderboard";
import coursesRouter from "./courses";
import groupsRouter from "./groups";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersMeRouter);
router.use(tripsRouter);
router.use(playersRouter);
router.use(roundsRouter);
router.use(scoresRouter);
router.use(scrambleScoresRouter);
router.use(leaderboardRouter);
router.use(coursesRouter);
router.use(groupsRouter);

export default router;
