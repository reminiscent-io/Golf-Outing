import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { autoCloseOverdueRounds } from "../lib/auto-close";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isAuthorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. Without
// CRON_SECRET set (local dev, Replit) the route always 401s; those hosts run
// the in-process sweeper from index.ts instead.
router.get("/cron/auto-close", async (req, res): Promise<void> => {
  if (!isAuthorized(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const closed = await autoCloseOverdueRounds();
    res.json({ closed });
  } catch (err) {
    logger.error({ err }, "Auto-close cron failed");
    res.status(500).json({ error: "Auto-close failed" });
  }
});

export default router;
